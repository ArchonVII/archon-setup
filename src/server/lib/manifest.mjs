export function recordCreatedFile(ctx, result, entry) {
  if (result?.status === "created" || result?.status === "overwrote") {
    ctx.manifest.createdFiles.push(entry);
  }
}
