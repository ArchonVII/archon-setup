export async function checkNetwork() {
  try {
    const res = await fetch("https://api.github.com/zen", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return {
        id: "network",
        status: "yellow",
        detail: `api.github.com responded ${res.status}`,
      };
    }
    return { id: "network", status: "green", detail: "api.github.com reachable" };
  } catch (err) {
    return {
      id: "network",
      status: "yellow",
      detail: "api.github.com unreachable — local-only mode still works",
      error: err.message,
    };
  }
}
