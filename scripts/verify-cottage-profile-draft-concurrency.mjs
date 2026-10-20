import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const harness = createLocalSupabaseConcurrencyHarness({
  timing: {
    check: "verify-cottage-profile-draft-concurrency",
    isolation: "serial",
  },
});
let timingOutcome = "failed";
try {
  harness.markTimingPhase("setup");
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required.");
  }
  const password = "Local-test-password-2026";
  async function resolveFixtureUser(credentials) {
    const client = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword(credentials);
    if (error || !data.user) {
      throw new Error("Cottage Profile concurrency identity is unavailable.", {
        cause: error,
      });
    }
    return data.user.id;
  }

  harness.guardDisposableLocalDatabase();

  const [ownerUserId, administratorUserId] = await Promise.all([
    resolveFixtureUser({ phone: "+9647510000000", password }),
    resolveFixtureUser({
      email: "cottage-profile-fixture-reviewer@rentcottage.test",
      password,
    }),
  ]);

  const claims = (userId, assurance) =>
    `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated","aal":"${assurance}"}', true);`;
  const ownerSession = (applicationName, body) => `
  begin;
  select set_config('application_name', '${applicationName}', false);
  set local role authenticated;
  ${claims(ownerUserId, "aal1")}
  ${body}
`;
  const administratorSession = (applicationName, body) => `
  begin;
  select set_config('application_name', '${applicationName}', false);
  set local role authenticated;
  ${claims(administratorUserId, "aal2")}
  ${body}
`;
  const sharedProfileRows = () =>
    harness.runSql(`
    select jsonb_build_object(
      'profiles', coalesce((select jsonb_agg(to_jsonb(profiles) order by id)
        from public.owner_application_cottage_profiles profiles
        where owner_user_id='${ownerUserId}'), '[]'::jsonb),
      'sources', coalesce((select jsonb_agg(to_jsonb(sources) order by sources.id)
        from public.cottage_profile_source_revisions sources
        join public.owner_application_cottage_profiles profiles on profiles.id=sources.profile_id
        where profiles.owner_user_id='${ownerUserId}'), '[]'::jsonb)
    );
  `);
  const retainedSharedProfiles = sharedProfileRows();
  const raceOwnerUserId = randomUUID();
  const raceOwnerPhone = "+999" + randomInt(100000000000, 1000000000000);
  harness.runSql(`
    begin;
    insert into auth.users (id, aud, role, phone, phone_confirmed_at, email, email_confirmed_at)
    values ('${raceOwnerUserId}', 'authenticated', 'authenticated', '${raceOwnerPhone}', now(), null, null);
    insert into public.account_contexts (user_id, role, owner_approval_state)
    values ('${raceOwnerUserId}', 'cottage_owner', 'approved');
    commit;
  `);
  const raceOwnerSession = (applicationName, body) => `
    begin;
    select set_config('application_name', '${applicationName}', false);
    set local role authenticated;
    ${claims(raceOwnerUserId, "aal1")}
    ${body}
  `;
  const capacityProfileIds = new Set();
  const clearAdditionalProfiles = () => {
    if (!capacityProfileIds.size) return;
    const ids = [...capacityProfileIds].map((id) => `'${id}'`).join(",");
    try {
      harness.runSql(`
        delete from public.owner_application_cottage_profiles
        where owner_user_id='${raceOwnerUserId}' and id=any(array[${ids}]::uuid[]);
      `);
      assert.equal(
        harness.runSql(`
        select count(*) from public.owner_application_cottage_profiles
        where owner_user_id='${raceOwnerUserId}' and id=any(array[${ids}]::uuid[]);
      `),
        "0",
      );
      capacityProfileIds.clear();
    } catch (error) {
      console.error("Retained capacity scenario profiles:", [
        ...capacityProfileIds,
      ]);
      throw error;
    }
  };
  const seedAdditionalProfiles = (count, status, age) => {
    const ids = harness
      .runSql(
        `
      insert into public.owner_application_cottage_profiles (
        owner_user_id, status, created_at, abandoned_at
      )
      select '${raceOwnerUserId}', '${status}', now() - interval '${age}',
        case when '${status}' = 'abandoned' then now() else null end
      from generate_series(1, ${count}) returning id;
    `,
      )
      .split("\n");
    assert.equal(ids.length, count);
    for (const id of ids) capacityProfileIds.add(id);
  };
  const capacityCounts = `
    select count(*) filter(where current_publication_id is null and status<>'abandoned')
      || '|' || count(*) filter(where application_id is null and created_at>now()-interval '24 hours')
    from public.owner_application_cottage_profiles where owner_user_id='${raceOwnerUserId}';
  `;
  const createdProfile = `select 'CREATED_PROFILE=' || (public.create_owner_cottage_profile_draft()).id;`;
  const recordCreatedProfiles = (session) => {
    for (const line of session.stdout.split("\n")) {
      if (line.startsWith("CREATED_PROFILE="))
        capacityProfileIds.add(line.slice("CREATED_PROFILE=".length));
    }
  };

  async function proveCreateRace({ name, seedStatus, seedAge, expectedCode }) {
    harness.markTimingPhase("setup");
    clearAdditionalProfiles();
    seedAdditionalProfiles(19, seedStatus, seedAge);
    assert.equal(
      harness.runSql(capacityCounts),
      seedStatus === "draft" ? "19|0" : "0|19",
    );
    harness.markTimingPhase("execution");
    const first = harness.startSession(
      raceOwnerSession(
        `${name}-winner`,
        `
      ${createdProfile}
      select '${name}-locked';
    `,
      ),
    );
    let contender;
    try {
      await harness.waitForMarker(first, `${name}-locked`);
      recordCreatedProfiles(first);
      const contenderName = `${name}-contender`;
      contender = harness.startSession(
        raceOwnerSession(
          contenderName,
          `
        ${createdProfile}
        commit;
      `,
        ),
        true,
      );
      await harness.waitForLock(contenderName, contender);
      await harness.finishSession(first, { action: "commit" });
      assert.equal(
        harness.runSql(capacityCounts),
        seedStatus === "draft" ? "20|1" : "1|20",
      );
      await harness.finishSession(contender, { expectedState: expectedCode });
      console.log(
        `${name}: observed PostgreSQL Lock wait and ${expectedCode} refusal.`,
      );
    } catch (error) {
      await harness.cleanUpOwnedSession(first, error);
      if (contender) await harness.cleanUpOwnedSession(contender, error);
      throw error;
    } finally {
      recordCreatedProfiles(first);
      if (contender) recordCreatedProfiles(contender);
      clearAdditionalProfiles();
    }
  }

  await proveCreateRace({
    name: "open-cap-create-vs-create",
    seedStatus: "draft",
    seedAge: "2 days",
    expectedCode: "RC420",
  });
  await proveCreateRace({
    name: "rate-only-create-vs-create",
    seedStatus: "abandoned",
    seedAge: "1 hour",
    expectedCode: "RC429",
  });

  harness.markTimingPhase("setup");
  seedAdditionalProfiles(19, "draft", "2 days");
  const abandonedProfileId = harness.runSql(`
    insert into public.owner_application_cottage_profiles (
      owner_user_id, status, created_at, abandoned_at
    ) values ('${raceOwnerUserId}', 'abandoned', now() - interval '2 days', now())
    returning id;
  `);
  capacityProfileIds.add(abandonedProfileId);
  assert.equal(harness.runSql(capacityCounts), "19|0");
  harness.markTimingPhase("execution");
  const creator = harness.startSession(
    raceOwnerSession(
      "create-vs-admin-restore-winner",
      `
    ${createdProfile}
    select 'create-vs-admin-restore-locked';
  `,
    ),
  );
  let restorer;
  try {
    await harness.waitForMarker(creator, "create-vs-admin-restore-locked");
    recordCreatedProfiles(creator);
    const restoreName = "create-vs-admin-restore-contender";
    restorer = harness.startSession(
      administratorSession(
        restoreName,
        `
      select public.restore_administrator_cottage_profile_draft(
        '${abandonedProfileId}', 1, 'Concurrency capacity proof'
      );
      commit;
    `,
      ),
      true,
    );
    await harness.waitForLock(restoreName, restorer);
    await harness.finishSession(creator, { action: "commit" });
    assert.equal(harness.runSql(capacityCounts), "20|1");
    await harness.finishSession(restorer, { expectedState: "RC420" });
    console.log(
      "create-vs-admin-restore: observed PostgreSQL Lock wait and RC420 refusal.",
    );
  } catch (error) {
    await harness.cleanUpOwnedSession(creator, error);
    if (restorer) await harness.cleanUpOwnedSession(restorer, error);
    throw error;
  } finally {
    recordCreatedProfiles(creator);
    clearAdditionalProfiles();
  }

  assert.equal(
    sharedProfileRows(),
    retainedSharedProfiles,
    "Capacity cases must preserve every retained shared-owner profile and immutable submitted source.",
  );
  harness.markTimingPhase("setup");
  const runtimeControl = JSON.parse(
    harness.runSql(`
    select to_jsonb(control) from public.cottage_translation_runtime_control control where singleton;
  `),
  );
  try {
    const fixture = JSON.parse(
      harness
        .runSql(
          `
      begin;
      update public.cottage_translation_runtime_control
      set production_ready = true,
          approved_evaluation_artifact_digest = repeat('a', 64),
          production_approval_digest = repeat('b', 64),
          provider_terms_approval_reference = 'test-provider-terms',
          native_review_approval_reference = 'test-native-review',
          quality_threshold_approval_reference = 'test-quality-threshold',
          ordinary_model = 'test-luna', ordinary_effort = 'none', ordinary_prompt_version = 'v1',
          stronger_model = 'test-terra', stronger_effort = 'none', stronger_prompt_version = 'v1',
          judge_model = 'test-sol', judge_effort = 'medium', judge_prompt_version = 'judge-v1',
          monthly_request_limit = 100, monthly_token_limit = 100000,
          monthly_spend_microusd_limit = 1000000,
          updated_at = now()
      where singleton;
      set local role authenticated;
      ${claims(raceOwnerUserId, "aal1")}
      do $$
      declare profile public.owner_application_cottage_profiles;
      begin
        select * into profile from public.create_owner_cottage_profile_draft();
        perform set_config('test.reconciliation_race_profile_id', profile.id::text, true);
        perform public.update_owner_cottage_profile_draft(
          profile.id, 1, 'Reconciliation race garden', 'Erbil', 'Near Shaqlawa',
          'Private race address', 36.4, 44.3, 'Private race directions',
          8, 3, 2, array['garden'], 'en', 'Race submitted description', 'Race submitted rules'
        );
        perform public.replace_cottage_shift_schedule(
          profile.id, 0,
          '[{"name":"Day","startTime":"08:00","endTime":"14:00"},{"name":"Evening","startTime":"18:00","endTime":"23:00"}]'
        );
        perform public.prepare_cottage_profile_photo_upload(profile.id, 'race.webp', 'image/webp', 128);
        perform public.prepare_cottage_profile_photo_upload(profile.id, 'race-second.webp', 'image/webp', 128);
      end;
      $$;
      reset role;
      insert into storage.objects (bucket_id, name, owner_id, metadata)
      select public.cottage_profile_photo_bucket_name(), photos.object_path,
        photos.owner_user_id::text, '{"size":128,"mimetype":"image/webp"}'::jsonb
      from public.cottage_profile_photos photos
      where photos.profile_id = current_setting('test.reconciliation_race_profile_id')::uuid;
      set local role service_role;
      select set_config('request.jwt.claims', '{"sub":"${administratorUserId}","role":"service_role","aal":"aal2"}', true);
      do $$
      begin
        perform public.register_cottage_profile_photo(id)
          from public.cottage_profile_photos
          where profile_id = current_setting('test.reconciliation_race_profile_id')::uuid;
      end;
      $$;
      set local role authenticated;
      ${claims(raceOwnerUserId, "aal1")}
      do $$
      begin
        perform public.submit_cottage_profile_for_content_approval(
          current_setting('test.reconciliation_race_profile_id')::uuid, 2
        );
        perform set_config('test.reconciliation_race_cycle_id', (
          select id::text from public.cottage_profile_review_cycles
          where profile_id = current_setting('test.reconciliation_race_profile_id')::uuid
        ), true);
      end;
      $$;
      set local role service_role;
      select set_config('request.jwt.claims', '{"sub":"${administratorUserId}","role":"service_role","aal":"aal2"}', true);
      do $$
      declare translated record;
      declare attempt public.cottage_profile_translation_attempts;
      begin
        for translated in
          select * from (values
            ('ar'::public.cottage_profile_source_language, 'حديقة هادئة', 'الهدوء في المساء'),
            ('ckb'::public.cottage_profile_source_language, 'باخچەیەکی ئارام', 'ئارامی لە ئێوارەدا')
          ) content(locale, description, house_rules)
        loop
          select * into attempt from public.begin_cottage_profile_translation_execution(
            current_setting('test.reconciliation_race_cycle_id')::uuid, translated.locale, 'ordinary', 50000
          );
          perform public.complete_cottage_profile_translation_execution(
            attempt.id, attempt.lease_token, translated.description, translated.house_rules,
            'test-provider', 'test-luna', 'none', 'v1'
          );
        end loop;
      end;
      $$;
      set local role authenticated;
      ${claims(administratorUserId, "aal2")}
      do $$
      begin
        perform public.correct_cottage_profile_localization(
          current_setting('test.reconciliation_race_cycle_id')::uuid, 'en',
          'Race baseline description', 'Race baseline rules', 'Correct the initial source wording'
        );
        perform public.decide_cottage_profile_localization(
          current_setting('test.reconciliation_race_cycle_id')::uuid, locale, true, 'Initial head approved'
        ) from unnest(array['en', 'ar', 'ckb']::public.cottage_profile_source_language[]) locale;
        perform public.approve_cottage_profile_publication(
          current_setting('test.reconciliation_race_cycle_id')::uuid, 'Publish race baseline'
        );
      end;
      $$;
      reset role;
      select set_config('test.reconciliation_race_report_revision_id', localizations.localized_revision_id::text, true)
      from public.owner_application_cottage_profiles profiles
      join public.cottage_publication_localizations localizations
        on localizations.publication_id = profiles.current_publication_id and localizations.locale = 'ar'
      where profiles.id = current_setting('test.reconciliation_race_profile_id')::uuid;
      set local role authenticated;
      ${claims(raceOwnerUserId, "aal1")}
      do $$
      declare report public.cottage_translation_quality_reports;
      begin
        select * into report from public.report_current_cottage_translation(
          current_setting('test.reconciliation_race_cycle_id')::uuid,
          current_setting('test.reconciliation_race_report_revision_id')::uuid,
          'Review this published generated wording'
        );
        perform set_config('test.reconciliation_race_remediation_id', report.remediation_review_cycle_id::text, true);
      end;
      $$;
      set local role authenticated;
      ${claims(administratorUserId, "aal2")}
      do $$
      begin
        perform public.correct_cottage_profile_localization(
          current_setting('test.reconciliation_race_remediation_id')::uuid, 'en',
          'Race approved description', 'Race approved rules', 'Correct the remediation source wording'
        );
        perform public.decide_cottage_profile_localization(
          current_setting('test.reconciliation_race_remediation_id')::uuid, locale, true, 'Remediation head approved'
        ) from unnest(array['en', 'ar', 'ckb']::public.cottage_profile_source_language[]) locale;
      end;
      $$;
      reset role;
      select jsonb_build_object(
        'profileId', id, 'ownerUserId', owner_user_id, 'version', version,
        'description', description, 'houseRules', house_rules,
        'reviewCycleId', current_setting('test.reconciliation_race_remediation_id')
      ) from public.owner_application_cottage_profiles
      where id = current_setting('test.reconciliation_race_profile_id')::uuid;
      commit;
    `,
        )
        .split("\n")
        .at(-1),
    );
    assert.equal(fixture.ownerUserId, raceOwnerUserId);
    assert.notEqual(fixture.ownerUserId, ownerUserId);
    assert.equal(fixture.version, 4);
    assert.equal(fixture.description, "Race baseline description");
    assert.equal(fixture.houseRules, "Race baseline rules");

    harness.markTimingPhase("execution");
    const saver = harness.startSession(`
      begin;
      select set_config('application_name', 'owner-save-vs-remediation-approval-winner', false);
      set local role authenticated;
      ${claims(raceOwnerUserId, "aal1")}
      select public.update_owner_cottage_profile_draft(
        '${fixture.profileId}', 4, 'Reconciliation race garden', 'Erbil', 'Near Shaqlawa',
        'Private race address', 36.4, 44.3, 'Private race directions',
        8, 3, 2, array['garden'], 'en', 'Race owner description', 'Race baseline rules'
      );
      select 'owner-save-version=' || version from public.owner_application_cottage_profiles
      where id = '${fixture.profileId}';
      select 'owner-save-vs-remediation-approval-locked';
    `);
    let approver;
    try {
      await harness.waitForMarker(
        saver,
        "owner-save-vs-remediation-approval-locked",
      );
      assert.ok(saver.stdout.split("\n").includes("owner-save-version=5"));
      const approverName = "owner-save-vs-remediation-approval-contender";
      approver = harness.startSession(
        administratorSession(
          approverName,
          `
          select public.approve_cottage_profile_publication('${fixture.reviewCycleId}', 'Approve concurrent remediation');
          commit;
        `,
        ),
        true,
      );
      await harness.waitForLock(approverName, approver);
      await harness.finishSession(saver, { action: "commit" });
      await harness.finishSession(approver);
    } catch (error) {
      await harness.cleanUpOwnedSession(saver, error);
      if (approver) await harness.cleanUpOwnedSession(approver, error);
      throw error;
    }
    const result = JSON.parse(
      harness.runSql(`
      select jsonb_build_object(
        'ownerUserId', profiles.owner_user_id,
        'description', profiles.description, 'houseRules', profiles.house_rules,
        'version', profiles.version, 'publicationNumber', snapshots.publication_number,
        'publishedDescription', localizations.description, 'publishedHouseRules', localizations.house_rules
      ) from public.owner_application_cottage_profiles profiles
      join public.cottage_publication_snapshots snapshots on snapshots.id = profiles.current_publication_id
      join public.cottage_publication_localizations localizations
        on localizations.publication_id = snapshots.id and localizations.locale = 'en'
      where profiles.id = '${fixture.profileId}';
    `),
    );
    assert.deepEqual(result, {
      ownerUserId: raceOwnerUserId,
      description: "Race owner description",
      houseRules: "Race approved rules",
      version: 6,
      publicationNumber: 2,
      publishedDescription: "Race approved description",
      publishedHouseRules: "Race approved rules",
    });
    console.log(
      "owner-save-vs-remediation-approval: observed PostgreSQL Lock wait; later owner description survived, untouched House Rules reconciled, and each operation advanced the version once.",
    );

    const visibilityFacts = () =>
      JSON.parse(
        harness.runSql(`
      select jsonb_build_object(
        'publicationId', profiles.current_publication_id,
        'photoIds', (select jsonb_agg(media.photo_id order by media.position)
          from public.cottage_publication_media media where media.publication_id=profiles.current_publication_id),
        'visibleCount', (select count(*) from public.cottage_publication_media media
          join public.cottage_profile_photos photos on photos.id=media.photo_id
          where media.publication_id=profiles.current_publication_id and not photos.public_hidden),
        'hiddenCount', (select count(*) from public.cottage_publication_media media
          join public.cottage_profile_photos photos on photos.id=media.photo_id
          where media.publication_id=profiles.current_publication_id and photos.public_hidden)
      ) from public.owner_application_cottage_profiles profiles where profiles.id='${fixture.profileId}';
    `),
      );
    const setPhotoVisibility = (publicationId, photoId, hidden) => `
      select public.set_administrator_cottage_photo_hidden('${fixture.profileId}', '${publicationId}',
        '${photoId}', ${hidden}, 'Concurrent visibility review');
    `;
    const initialVisibility = visibilityFacts();
    assert.equal(initialVisibility.visibleCount, 2);
    const [firstPhotoId, secondPhotoId] = initialVisibility.photoIds;
    assert.equal(initialVisibility.photoIds.length, 2);

    for (const name of [
      "competing-photo-hides",
      "hide-before-publication-approval",
      "publication-approval-before-hide",
      "restore-before-publication-approval",
      "hide-before-working-copy-deletion",
    ]) {
      harness.markTimingPhase("setup");
      let current = visibilityFacts();
      if (name === "restore-before-publication-approval") {
        harness.runSql(
          administratorSession(
            `${name}-prepare-hide`,
            `
          ${setPhotoVisibility(current.publicationId, firstPhotoId, true)}
          commit;
        `,
          ),
        );
      }
      let reviewCycleId;
      if (name.includes("publication-approval")) {
        reviewCycleId = JSON.parse(
          harness
            .runSql(
              `
          begin;
          select set_config('test.visibility_current_cycle', snapshots.review_cycle_id::text, true),
            set_config('test.visibility_report_revision', localizations.localized_revision_id::text, true)
          from public.owner_application_cottage_profiles profiles
          join public.cottage_publication_snapshots snapshots on snapshots.id=profiles.current_publication_id
          join public.cottage_publication_localizations localizations
            on localizations.publication_id=snapshots.id and localizations.locale='ar'
          where profiles.id='${fixture.profileId}';
          set local role authenticated;
          ${claims(raceOwnerUserId, "aal1")}
          do $$
          declare report public.cottage_translation_quality_reports;
          begin
            select * into report from public.report_current_cottage_translation(
              current_setting('test.visibility_current_cycle')::uuid,
              current_setting('test.visibility_report_revision')::uuid, 'Concurrent published language review');
            perform set_config('test.visibility_review_cycle', report.remediation_review_cycle_id::text, true);
          end $$;
          ${claims(administratorUserId, "aal2")}
          do $$ begin
            perform public.decide_cottage_profile_localization(
              current_setting('test.visibility_review_cycle')::uuid, locale, true, 'Concurrent reviewed head')
            from unnest(array['en','ar','ckb']::public.cottage_profile_source_language[]) locale;
          end $$;
          select to_jsonb(current_setting('test.visibility_review_cycle'));
          commit;
        `,
            )
            .split("\n")
            .at(-1),
        );
      }
      current = visibilityFacts();
      const approve = `select public.approve_cottage_profile_publication('${reviewCycleId}', 'Publish concurrent review');`;
      const approvalFirst = name === "publication-approval-before-hide";
      const firstBody = approvalFirst
        ? approve
        : setPhotoVisibility(
            current.publicationId,
            firstPhotoId,
            name !== "restore-before-publication-approval",
          );
      const secondBody =
        name === "competing-photo-hides"
          ? setPhotoVisibility(current.publicationId, secondPhotoId, true)
          : name === "hide-before-working-copy-deletion"
            ? `select public.prepare_cottage_profile_photo_deletion('${firstPhotoId}');`
            : approvalFirst
              ? setPhotoVisibility(current.publicationId, firstPhotoId, true)
              : approve;
      const expectedState =
        name === "competing-photo-hides"
          ? "RC203"
          : approvalFirst
            ? "RC409"
            : undefined;
      harness.markTimingPhase("execution");
      const winner = harness.startSession(
        administratorSession(
          `${name}-winner`,
          `
        ${firstBody}
        select '${name}-locked';
      `,
        ),
      );
      let contender;
      try {
        await harness.waitForMarker(winner, `${name}-locked`);
        const contenderName = `${name}-contender`;
        contender = harness.startSession(
          name === "hide-before-working-copy-deletion"
            ? `begin;
              select set_config('application_name', '${contenderName}', false);
              set local role authenticated;
              ${claims(raceOwnerUserId, "aal1")}
              ${secondBody}
              commit;`
            : administratorSession(contenderName, `${secondBody} commit;`),
          true,
        );
        await harness.waitForLock(contenderName, contender);
        await harness.finishSession(winner, { action: "commit" });
        await harness.finishSession(
          contender,
          expectedState ? { expectedState } : undefined,
        );
      } catch (error) {
        await harness.cleanUpOwnedSession(winner, error);
        if (contender) await harness.cleanUpOwnedSession(contender, error);
        throw error;
      }
      const settled = visibilityFacts();
      assert.equal(settled.photoIds.length, 2);
      assert.deepEqual(settled.photoIds, initialVisibility.photoIds);
      assert.equal(
        settled.visibleCount,
        approvalFirst || name === "restore-before-publication-approval" ? 2 : 1,
      );
      assert.equal(settled.hiddenCount, 2 - settled.visibleCount);
      if (name.includes("publication-approval")) {
        assert.notEqual(settled.publicationId, current.publicationId);
        assert.equal(
          harness.runSql(
            `select state from public.cottage_profile_review_cycles where id='${reviewCycleId}';`,
          ),
          "approved",
        );
      } else {
        assert.equal(settled.publicationId, current.publicationId);
      }
      if (name === "hide-before-working-copy-deletion") {
        assert.deepEqual(
          JSON.parse(
            harness.runSql(`
          select jsonb_build_object('active',is_active,'hidden',public_hidden,'state',state)
          from public.cottage_profile_photos where id='${firstPhotoId}';
        `),
          ),
          { active: false, hidden: true, state: "ready" },
        );
      }
      harness.runSql(
        administratorSession(
          `${name}-restore`,
          `
        ${setPhotoVisibility(settled.publicationId, firstPhotoId, false)}
        commit;
      `,
        ),
      );
      assert.equal(visibilityFacts().visibleCount, 2);
      console.log(
        `${name}: observed PostgreSQL Lock wait; ${expectedState ?? "both transitions committed"}; current publication retains visible media and explicit restoration succeeds.`,
      );
    }
  } finally {
    harness.markTimingPhase("cleanup");
    harness.runSql(`
      delete from public.cottage_marketplace_listings listing
      using public.owner_application_cottage_profiles profile
      where listing.profile_id = profile.id
        and profile.owner_user_id = '${raceOwnerUserId}';
    `);
    assert.equal(
      harness.runSql(`
        select count(*)
        from public.cottage_marketplace_listings listing
        join public.owner_application_cottage_profiles profile
          on profile.id = listing.profile_id
        where profile.owner_user_id = '${raceOwnerUserId}';
      `),
      "0",
    );
    const columns = Object.keys(runtimeControl)
      .filter((column) => column !== "singleton")
      .map((column) => `"${column}"`)
      .join(", ");
    harness.runSql(`
      update public.cottage_translation_runtime_control set (${columns}) = (
        select ${columns} from jsonb_populate_record(
          null::public.cottage_translation_runtime_control,
          '${JSON.stringify(runtimeControl).replaceAll("'", "''")}'::jsonb
        )
      ) where singleton;
    `);
    assert.deepEqual(
      JSON.parse(
        harness.runSql(`
      select to_jsonb(control) from public.cottage_translation_runtime_control control where singleton;
    `),
      ),
      runtimeControl,
    );
  }
  for (const operation of ["update", "submit"]) {
    harness.markTimingPhase("setup");
    const suspensionCommandId = randomUUID();
    const reactivationCommandId = randomUUID();
    const suspensionReason = `Fictional held-profile owner ${operation} ${suspensionCommandId}`;
    const reactivationReason = `Restore fictional held-profile owner ${operation} ${reactivationCommandId}`;
    let suspensionProfileId;
    let suspensionApplication;
    let baselineHistory;
    const ownerEligibility = () =>
      harness
        .runSql(
          ownerSession(
            `owner-${operation}-suspension-eligibility`,
            `
      select public.owner_can_start_new_business('${ownerUserId}');
      rollback;
    `,
          ),
        )
        .split("\n")
        .at(-1);
    const ownerHistory = () =>
      JSON.parse(
        harness.runSql(`
    select jsonb_build_object(
      'transitions', coalesce((select jsonb_agg(to_jsonb(transitions) order by id)
        from public.owner_application_transitions transitions
        where application_id='${suspensionApplication.id}'), '[]'::jsonb),
      'notices', coalesce((select jsonb_agg(to_jsonb(notices) order by id)
        from public.owner_application_notices notices
        where application_id='${suspensionApplication.id}'), '[]'::jsonb),
      'actions', coalesce((select jsonb_agg(to_jsonb(actions) order by id)
        from private.marketplace_suspension_actions actions
        where account_user_id='${ownerUserId}'), '[]'::jsonb)
    );
  `),
      );
    const profileBytes = () =>
      harness.runSql(`
      select jsonb_build_object(
        'profile', to_jsonb(profiles),
        'sources', coalesce((select jsonb_agg(to_jsonb(sources) order by id)
          from public.cottage_profile_source_revisions sources where profile_id=profiles.id), '[]'::jsonb),
        'photos', coalesce((select jsonb_agg(to_jsonb(photos) order by id)
          from public.cottage_profile_photos photos where profile_id=profiles.id), '[]'::jsonb),
        'objects', coalesce((select jsonb_agg(to_jsonb(objects) order by objects.id)
          from storage.objects objects join public.cottage_profile_photos photos
            on objects.bucket_id=public.cottage_profile_photo_bucket_name() and objects.name=photos.object_path
          where photos.profile_id=profiles.id), '[]'::jsonb),
        'cycles', coalesce((select jsonb_agg(to_jsonb(cycles) order by id)
          from public.cottage_profile_review_cycles cycles where profile_id=profiles.id), '[]'::jsonb),
        'localizedRevisions', coalesce((select jsonb_agg(to_jsonb(localizations) order by localizations.id)
          from public.cottage_profile_localized_revisions localizations
          join public.cottage_profile_review_cycles cycles on cycles.id=localizations.review_cycle_id
          where cycles.profile_id=profiles.id), '[]'::jsonb),
        'reviewPhotos', coalesce((select jsonb_agg(to_jsonb(photos) order by photos.position)
          from public.cottage_profile_review_photos photos
          join public.cottage_profile_review_cycles cycles on cycles.id=photos.review_cycle_id
          where cycles.profile_id=profiles.id), '[]'::jsonb)
      ) from public.owner_application_cottage_profiles profiles where id='${suspensionProfileId}';
    `);
    try {
      assert.equal(
        ownerEligibility(),
        "t",
        "The suspension race requires a genuinely approved owner with current verification.",
      );
      suspensionApplication = JSON.parse(
        harness.runSql(`
      select jsonb_build_object('id', applications.id, 'version', applications.version,
        'suspensionRevision', contexts.owner_suspension_revision)
      from public.owner_applications applications
      join public.account_contexts contexts on contexts.user_id=applications.owner_user_id
      where applications.owner_user_id='${ownerUserId}' and applications.status='approved';
    `),
      );
      baselineHistory = ownerHistory();
      assert.equal(
        harness.runSql(`
      select count(*) from public.booking_requests
      where owner_user_id='${ownerUserId}' and status='pending';
    `),
        "0",
        "The shared owner must have no unrelated pending requests before suspension.",
      );
      suspensionProfileId = harness
        .runSql(
          ownerSession(
            `owner-${operation}-suspension-setup`,
            `
        select (public.create_owner_cottage_profile_draft()).id;
        commit;
      `,
          ),
        )
        .split("\n")
        .at(-1);
      harness.runSql(
        ownerSession(
          `owner-${operation}-suspension-baseline`,
          `
      select public.update_owner_cottage_profile_draft(
        '${suspensionProfileId}', 1, 'Suspension race garden', 'Erbil', 'Near Shaqlawa',
        'Private race address', 36.4, 44.3, 'Private race directions',
        8, 3, 2, array['garden'], 'en', 'Race baseline description', 'Race baseline rules'
      );
      commit;
    `,
        ),
      );
      if (operation === "submit") {
        harness.runSql(
          ownerSession(
            `owner-${operation}-suspension-photo`,
            `
        select public.prepare_cottage_profile_photo_upload(
          '${suspensionProfileId}', 'suspension-submit.webp', 'image/webp', 128
        );
        commit;
      `,
          ),
        );
        harness.runSql(`
        begin;
        insert into storage.objects (bucket_id, name, owner_id, metadata)
        select public.cottage_profile_photo_bucket_name(), object_path, owner_user_id::text,
          '{"size":128,"mimetype":"image/webp"}'::jsonb
        from public.cottage_profile_photos where profile_id='${suspensionProfileId}';
        set local role service_role;
        select set_config('request.jwt.claims', '{"sub":"${administratorUserId}","role":"service_role","aal":"aal2"}', true);
        select public.register_cottage_profile_photo(id) from public.cottage_profile_photos
        where profile_id='${suspensionProfileId}';
        commit;
      `);
      }
      const before = profileBytes();
      assert.equal(JSON.parse(before).profile.version, 2);
      harness.markTimingPhase("execution");
      const holder = harness.startSession(`
      begin;
      set application_name='owner-${operation}-suspension-holder';
      select id from public.owner_application_cottage_profiles
      where id='${suspensionProfileId}' for update;
      select 'OWNER_WRITE_PROFILE_HELD';
    `);
      let contender;
      try {
        await harness.waitForMarker(holder, "OWNER_WRITE_PROFILE_HELD");
        contender = harness.startSession(
          ownerSession(
            `owner-${operation}-suspension-contender`,
            `
          ${
            operation === "submit"
              ? `select public.submit_cottage_profile_for_content_approval('${suspensionProfileId}', 2);`
              : `select public.update_owner_cottage_profile_draft(
              '${suspensionProfileId}', 2, 'Suspension race garden', 'Erbil', 'Near Shaqlawa',
              'Private race address', 36.4, 44.3, 'Private race directions',
              8, 3, 2, array['garden'], 'en', 'Unsafe suspended owner description', 'Race baseline rules'
            );`
          }
          commit;
        `,
          ),
          true,
        );
        await harness.waitForLock(
          `owner-${operation}-suspension-contender`,
          contender,
        );
        holder.child.stdin.write(`
        set local role authenticated;
        ${claims(administratorUserId, "aal2")}
        select 'OWNER_SUSPENSION=' || public.set_marketplace_suspension(
          'owner', '${ownerUserId}', 'suspend', ${suspensionApplication.version},
          '${suspensionReason}', '${suspensionCommandId}'
        )::text;
        select 'OWNER_WRITE_SUSPENDED';
      `);
        await harness.waitForMarker(holder, "OWNER_WRITE_SUSPENDED");
        const suspension = JSON.parse(
          holder.stdout
            .split("\n")
            .find((line) => line.startsWith("OWNER_SUSPENSION="))
            .slice("OWNER_SUSPENSION=".length),
        );
        assert.equal(suspension.status, "completed");
        await harness.finishSession(holder, { action: "commit" });
        await contender.exited;
        const after = profileBytes();
        assert.equal(
          after,
          before,
          `owner_write_rechecks_after_profile_wait ${operation} changed the working copy after suspension: ${after}`,
        );
        await harness.finishSession(contender, { expectedState: "42501" });
      } catch (error) {
        await harness.cleanUpOwnedSession(holder, error);
        if (contender) await harness.cleanUpOwnedSession(contender, error);
        throw error;
      }
      console.log(
        `owner_write_rechecks_after_profile_wait ${operation}: held-profile suspension committed; waiting owner write denied with 42501 and exact working-copy/source/photo bytes retained.`,
      );
    } finally {
      harness.markTimingPhase("cleanup");
      if (suspensionApplication) {
        const currentHistory = ownerHistory();
        const ownActions = currentHistory.actions.filter(
          (action) => action.command_id === suspensionCommandId,
        );
        if (ownActions.length) {
          assert.equal(ownActions.length, 1);
          const action = ownActions[0];
          assert.equal(action.target_kind, "owner");
          assert.equal(action.actor_user_id, administratorUserId);
          assert.equal(action.reason, suspensionReason);
          const current = JSON.parse(
            harness
              .runSql(
                administratorSession(
                  `owner-${operation}-suspension-restoration-check`,
                  `
            select public.get_marketplace_suspension('owner', '${ownerUserId}');
            rollback;
          `,
                ),
              )
              .split("\n")
              .at(-1),
          );
          assert.equal(current.status, "ready");
          assert.equal(current.state, "suspended");
          assert.equal(
            current.revision,
            action.resulting_revision,
            "The current suspension must still be attributable to this scenario command.",
          );
          assert.equal(current.canReactivate, true);
          assert.equal(current.restorationState, "approved");
          const restored = JSON.parse(
            harness
              .runSql(
                administratorSession(
                  `owner-${operation}-suspension-reactivate`,
                  `
            select public.set_marketplace_suspension('owner', '${ownerUserId}', 'reactivate',
              ${current.revision}, '${reactivationReason}', '${reactivationCommandId}');
            commit;
          `,
                ),
              )
              .split("\n")
              .at(-1),
          );
          assert.equal(restored.status, "completed");
          assert.equal(ownerEligibility(), "t");
          const retained = ownerHistory();
          for (const key of ["transitions", "notices", "actions"]) {
            const baselineIds = new Set(
              baselineHistory[key].map((row) => row.id),
            );
            assert.deepEqual(
              retained[key].filter((row) => baselineIds.has(row.id)),
              baselineHistory[key],
            );
          }
          const newActions = retained.actions.filter(
            (row) => !baselineHistory.actions.some((old) => old.id === row.id),
          );
          assert.equal(newActions.length, 2);
          for (const [commandId, reason, expectedRevision, targetAction] of [
            [
              suspensionCommandId,
              suspensionReason,
              suspensionApplication.version,
              "suspend",
            ],
            [
              reactivationCommandId,
              reactivationReason,
              current.revision,
              "reactivate",
            ],
          ]) {
            const matching = newActions.filter(
              (row) => row.command_id === commandId,
            );
            assert.equal(matching.length, 1);
            assert.equal(matching[0].reason, reason);
            assert.equal(matching[0].actor_user_id, administratorUserId);
            assert.equal(matching[0].expected_revision, expectedRevision);
            assert.equal(matching[0].resulting_revision, expectedRevision + 1);
            assert.equal(matching[0].action, targetAction);
            const transitions = retained.transitions.filter(
              (row) =>
                row.application_version === expectedRevision + 1 &&
                row.reason === reason,
            );
            assert.equal(transitions.length, 1);
            assert.equal(transitions[0].actor_user_id, administratorUserId);
          }
          assert.equal(
            retained.transitions.length,
            baselineHistory.transitions.length + 2,
          );
          const notices = retained.notices.filter(
            (row) => row.reason === suspensionReason,
          );
          assert.equal(notices.length, 1);
          assert.equal(notices[0].kind, "suspended");
          assert.equal(
            retained.notices.length,
            baselineHistory.notices.length + 1,
          );
          assert.equal(
            harness.runSql(`
          select applications.version || '|' || contexts.owner_suspension_revision
          from public.owner_applications applications
          join public.account_contexts contexts on contexts.user_id=applications.owner_user_id
          where applications.id='${suspensionApplication.id}';
        `),
            `${suspensionApplication.version + 2}|${suspensionApplication.suspensionRevision + 2}`,
          );
          console.log(
            `owner_write_rechecks_after_profile_wait ${operation} history: retained all prior rows and both scenario actions, two transitions and one suspension notice; real reactivation preserved monotonic counters.`,
          );
        }
        if (suspensionProfileId && operation === "submit") {
          const retained = JSON.parse(profileBytes());
          assert.equal(retained.photos.length, 1);
          assert.equal(retained.photos[0].state, "ready");
          assert.equal(retained.objects.length, 1);
          if (retained.sources.length) {
            assert.equal(retained.sources.length, 1);
            assert.equal(
              retained.profile.status,
              "submitted_for_content_approval",
            );
            assert.equal(retained.profile.version, 3);
            assert.equal(
              retained.profile.submitted_source_revision_id,
              retained.sources[0].id,
            );
            assert.equal(retained.cycles.length, 1);
            assert.equal(
              retained.cycles[0].source_revision_id,
              retained.sources[0].id,
            );
            assert.equal(retained.localizedRevisions.length, 1);
            assert.equal(retained.reviewPhotos.length, 1);
            assert.equal(
              retained.reviewPhotos[0].photo_id,
              retained.photos[0].id,
            );
          } else {
            assert.equal(retained.profile.status, "draft");
            assert.equal(retained.profile.version, 2);
            assert.equal(retained.cycles.length, 0);
          }
          console.log(
            "owner-submit retained evidence:",
            JSON.stringify({
              profileId: retained.profile.id,
              status: retained.profile.status,
              version: retained.profile.version,
              suspensionCommandId,
              reactivationCommandId,
              submittedSourceRevisionId:
                retained.profile.submitted_source_revision_id,
              sourceIds: retained.sources.map((row) => row.id),
              photoIds: retained.photos.map((row) => row.id),
              storageObjectIds: retained.objects.map((row) => row.id),
              reviewCycleIds: retained.cycles.map((row) => row.id),
              localizedRevisionIds: retained.localizedRevisions.map(
                (row) => row.id,
              ),
              reviewPhotos: retained.reviewPhotos.map((row) => ({
                cycleId: row.review_cycle_id,
                photoId: row.photo_id,
              })),
              disposition: retained.sources.length
                ? "immutable submitted graph"
                : "ready photo/storage graph",
            }),
          );
        } else if (suspensionProfileId) {
          harness.runSql(`
          delete from public.owner_application_cottage_profiles
          where id='${suspensionProfileId}' and owner_user_id='${ownerUserId}' and application_id is null;
        `);
          assert.equal(
            harness.runSql(`
          select count(*) from public.owner_application_cottage_profiles where id='${suspensionProfileId}';
        `),
            "0",
          );
        }
      }
    }
  }
  timingOutcome = "passed";
} finally {
  harness.finishTiming({
    outcome: timingOutcome,
    cleanupDisposition: "project-teardown",
  });
}
