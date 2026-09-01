export function capture(operation) {
  try {
    return { threw: false, value: operation() };
  } catch (error) {
    return { error, threw: true };
  }
}

export function describeThrown(value) {
  const errorMessage = capture(() =>
    value instanceof Error ? value.message : undefined,
  );
  if (
    !errorMessage.threw &&
    typeof errorMessage.value === "string" &&
    errorMessage.value.length > 0
  ) {
    return errorMessage.value;
  }
  const description = capture(() => String(value));
  return description.threw ? "<unprintable thrown value>" : description.value;
}
