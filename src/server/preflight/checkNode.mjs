export function checkNode() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < 20) {
    return {
      id: "node",
      status: "red",
      detail: `Node ${process.versions.node} < 20`,
      fix: "Install Node 20 LTS or newer: https://nodejs.org",
    };
  }
  return { id: "node", status: "green", detail: `Node ${process.versions.node}` };
}
