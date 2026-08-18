const url = process.argv[2] || `http://localhost:${process.env.PORT || 8000}/health`;
const requests = Number.parseInt(process.env.REQUESTS || '100', 10);

async function main() {
  const start = performance.now();

  for (let request = 0; request < requests; request += 1) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
  }

  const elapsedMs = Math.round(performance.now() - start);
  console.log(`Completed ${requests} requests in ${elapsedMs} ms`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});