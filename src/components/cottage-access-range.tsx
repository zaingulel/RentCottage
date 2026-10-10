export function CottageAccessRange({
  template,
  start,
  end,
}: {
  template: string;
  start: string;
  end: string;
}) {
  return template.split(/(\{start\}|\{end\})/).map((part, index) =>
    part === "{start}" || part === "{end}" ? (
      <bdi dir="ltr" key={index}>
        {part === "{start}" ? start : end}
      </bdi>
    ) : (
      part
    ),
  );
}
