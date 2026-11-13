import type { z } from "zod";

/** Where an issue is in the file: `steps[1].prompt`, `human-workflows.crosscheck[0].cli`. Empty for the file itself. */
function locate(path: ReadonlyArray<PropertyKey>): string {
  let text = "";
  for (const part of path) {
    text += typeof part === "number" ? `[${part}]` : `${text === "" ? "" : "."}${String(part)}`;
  }
  return text;
}

/** Every problem a schema found, each with its place in the file, as one line. The one place errors are worded. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = locate(issue.path);
      return where === "" ? issue.message : `${where}: ${issue.message}`;
    })
    .join("; ");
}

/** A schema's verdict on a value: the checked value, or the problems as text. */
export function check<T>(schema: z.ZodType<T>, value: unknown): { value: T } | { problem: string } {
  const result = schema.safeParse(value);
  return result.success ? { value: result.data } : { problem: describeIssues(result.error) };
}
