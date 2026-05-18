const { Client } = require("../apps/api/node_modules/pg");
const fs = require("fs");
const path = require("path");

const env = fs
  .readFileSync(path.join(__dirname, "..", ".env"), "utf8")
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith("#"))
  .reduce((acc, line) => {
    const idx = line.indexOf("=");
    if (idx > 0) acc[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    return acc;
  }, {});

const TASK_ID = process.argv[2] || "c764516e-12e5-4b5e-973b-edecf4e7df07";

(async () => {
  const c = new Client({ connectionString: env.DATABASE_URL });
  await c.connect();

  const t = (
    await c.query(
      `SELECT id, user_id, status, target_count, created_at, updated_at, input_payload
       FROM lead_tasks WHERE id = $1`,
      [TASK_ID]
    )
  ).rows[0];
  if (!t) {
    console.log("TASK NOT FOUND");
    await c.end();
    return;
  }
  console.log("=== TASK ===");
  console.log({
    id: t.id,
    status: t.status,
    targetCount: t.target_count,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    promptLen: (t.input_payload?.prompt ?? "").length,
    promptPreview: (t.input_payload?.prompt ?? "").slice(0, 400),
    inputKeys: Object.keys(t.input_payload || {}),
    productProfile: t.input_payload?.productProfile ? Object.keys(t.input_payload.productProfile) : null,
    customerProfile: t.input_payload?.customerProfile ? Object.keys(t.input_payload.customerProfile) : null
  });

  if (t.input_payload?.productProfile) {
    console.log("\n--- productProfile ---");
    console.log(JSON.stringify(t.input_payload.productProfile, null, 2).slice(0, 1500));
  }
  if (t.input_payload?.customerProfile) {
    console.log("\n--- customerProfile ---");
    console.log(JSON.stringify(t.input_payload.customerProfile, null, 2).slice(0, 1500));
  }
  if (t.input_payload?.productProfileAnalysis) {
    console.log("\n--- productProfileAnalysis ---");
    console.log(JSON.stringify(t.input_payload.productProfileAnalysis, null, 2).slice(0, 2000));
  }
  if (t.input_payload?.customerProfileAnalysis) {
    console.log("\n--- customerProfileAnalysis ---");
    console.log(JSON.stringify(t.input_payload.customerProfileAnalysis, null, 2).slice(0, 2000));
  }
  if (t.input_payload?.keywordGroups) {
    console.log("\n--- keywordGroups ---");
    console.log(JSON.stringify(t.input_payload.keywordGroups, null, 2).slice(0, 2000));
  }
  if (t.input_payload?.searchQueries) {
    console.log(
      `\n--- planned searchQueries (#${t.input_payload.searchQueries.length}) ---`
    );
    for (const q of t.input_payload.searchQueries.slice(0, 30)) {
      console.log(
        `[${q.country ?? "-"}] ${q.operatorName ?? q.strategyTemplate ?? ""} :: ${q.query}`
      );
    }
  }

  console.log("\n=== STEPS ===");
  const steps = (
    await c.query(
      `SELECT id, name, status, started_at, completed_at, error, output
       FROM agent_steps WHERE task_id = $1 ORDER BY created_at ASC`,
      [TASK_ID]
    )
  ).rows;
  for (const s of steps) {
    console.log(
      `${s.name}\t${s.status}\tstart=${s.started_at?.toISOString?.() ?? s.started_at}\tend=${
        s.completed_at?.toISOString?.() ?? s.completed_at
      }${s.error ? `\nERR: ${s.error.slice(0, 600)}` : ""}`
    );
    if (s.output) {
      const out = JSON.stringify(s.output, null, 2);
      console.log(out.length > 1200 ? out.slice(0, 1200) + " …" : out);
    }
  }

  console.log("\n=== SEARCH QUERIES ===");
  const sq = (
    await c.query(
      `SELECT id, provider, operator_source, operator_name, strategy_template, country,
              execution_status, result_count, qualified_count, created_at, updated_at, query
       FROM search_queries WHERE task_id = $1 ORDER BY created_at ASC`,
      [TASK_ID]
    )
  ).rows;
  console.log(`total queries: ${sq.length}`);
  const byStatus = sq.reduce((acc, q) => {
    acc[q.execution_status] = (acc[q.execution_status] || 0) + 1;
    return acc;
  }, {});
  console.log("by status:", byStatus);
  for (const q of sq) {
    console.log(
      `[${q.execution_status}] [${q.country ?? "-"}] r=${q.result_count} q=${q.qualified_count} :: ${q.query}`
    );
  }

  console.log("\n=== SEARCH RESULTS (sample) ===");
  const sr = (
    await c.query(
      `SELECT sr.id, sr.title, sr.url, sr.domain, sq.country, sq.query
       FROM search_results sr JOIN search_queries sq ON sq.id = sr.query_id
       WHERE sq.task_id = $1 ORDER BY sr.created_at ASC`,
      [TASK_ID]
    )
  ).rows;
  console.log(`total search_results: ${sr.length}`);
  for (const r of sr.slice(0, 30)) {
    console.log(`- [${r.country}] ${r.domain} :: ${r.title}`);
  }

  console.log("\n=== LEAD CANDIDATES ===");
  const lc = (
    await c.query(
      `SELECT lc.id, lc.company_name, lc.website, lc.country, lc.country_confidence,
              lc.country_conflict, lc.status, lc.created_at,
              icp.score, icp.grade
       FROM lead_candidates lc
       LEFT JOIN icp_scores icp ON icp.lead_id = lc.id
       WHERE lc.task_id = $1 ORDER BY lc.created_at ASC`,
      [TASK_ID]
    )
  ).rows;
  console.log(`total lead_candidates: ${lc.length}`);
  const byCountry = lc.reduce((acc, q) => {
    acc[q.country ?? "?"] = (acc[q.country ?? "?"] || 0) + 1;
    return acc;
  }, {});
  console.log("by country:", byCountry);
  const byStatusCand = lc.reduce((acc, q) => {
    acc[q.status] = (acc[q.status] || 0) + 1;
    return acc;
  }, {});
  console.log("by status:", byStatusCand);
  for (const r of lc.slice(0, 60)) {
    console.log(
      `${r.status}\t[${r.country ?? "-"}/${r.country_confidence ?? "-"}/${r.country_conflict ? "CONFLICT" : ""}]\t${r.score ?? "-"}\t${r.company_name}\t${r.website ?? ""}`
    );
  }

  await c.end();
})();
