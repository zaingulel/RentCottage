import type {
  NotificationDeliveryAdapter,
  NotificationExecuteResult,
  NotificationLease,
  NotificationQueryResult,
} from "./notification-delivery";
import { bookingRequestTestRuntimeIsEnabled } from "@/booking-request/booking-request-test-runtime-core";

interface FictionalNotificationEnvironment {
  readonly APP_ENVIRONMENT?: string;
  readonly SUPABASE_PROJECT_REF?: string;
  readonly SUPABASE_URL?: string;
}

export interface FictionalNotificationEffectRepository {
  queryEffect(lease: NotificationLease): Promise<NotificationQueryResult>;
  executeEffect(lease: NotificationLease): Promise<NotificationExecuteResult>;
}

export class FictionalNotificationAdapter implements NotificationDeliveryAdapter {
  readonly #effects: FictionalNotificationEffectRepository;

  constructor(
    effects: FictionalNotificationEffectRepository,
    environment: FictionalNotificationEnvironment = process.env,
  ) {
    if (!bookingRequestTestRuntimeIsEnabled(environment))
      throw new Error(
        "Fictional notifications require the exact local test runtime",
      );
    this.#effects = effects;
  }

  query(lease: NotificationLease) {
    return this.#effects.queryEffect(lease);
  }

  execute(lease: NotificationLease) {
    return this.#effects.executeEffect(lease);
  }
}
