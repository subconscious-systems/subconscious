# Tests

This directory contains integration tests for the agent.

## Running Tests

```bash
# Run all tests
bun test

# Run a specific test
bun test tests/statistical_analysis.test.ts
```

## Test Requirements

Tests require:
- `SUBCONSCIOUS_API_KEY` environment variable
- `cloudflared` installed (for automatic tunnel setup)
- Network connectivity

**Tunnel Setup**: The agent automatically starts a Cloudflare tunnel - no manual setup needed! Just make sure `cloudflared` is installed:
```bash
brew install cloudflare/cloudflare/cloudflared
```

If `SUBCONSCIOUS_API_KEY` is not set, tests will skip with a warning rather than failing.

## Test Files

### `statistical_analysis.test.ts`

Tests the agent's ability to:
- Parse file references from task descriptions (human-like input)
- Upload CSV files to the sandbox
- Perform statistical analysis using Python/pandas
- Generate output files with results

**Test Data**: `sales_data.csv` - Sample sales data with Date, Product, Category, Sales, Quantity, and Region columns.

**Expected Output**: `output/analysis_results.json` - JSON file containing statistical analysis results.

## Example Test Run

```bash
# Set up environment
export SUBCONSCIOUS_API_KEY=your_key_here
export TUNNEL_URL=https://xxxx-xxxx.trycloudflare.com

# Run test
bun test tests/statistical_analysis.test.ts
```

The test simulates a human user by including the file path directly in the task description, just like a real user would:

```
Perform statistical analysis on file: tests/sales_data.csv.
Calculate and report:
1. Total sales across all records
2. Average sales per transaction
...
```
