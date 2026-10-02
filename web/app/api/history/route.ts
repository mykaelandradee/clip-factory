import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";

export const runtime = "nodejs";

const GITHUB_API = "https://api.github.com";
const OWNER = "mykaelandradee";
const REPO = "clip-factory";
const WORKFLOW = "clip-factory-worker.yml";

function githubToken() {
  const token = process.env.CLIP_FACTORY_GITHUB_TOKEN;
  if (!token) throw new Error("CLIP_FACTORY_GITHUB_TOKEN não configurado.");
  return token;
}

async function githubFetch(path: string) {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken()}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      return NextResponse.json({ error: "Faça login para acessar o histórico." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: jobs, error } = await admin
      .from("clip_jobs")
      .select("id, created_at, source_url, source_title, requested_count, min_duration, max_duration, subtitle_language, caption_style")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("History lookup failed:", error.message);
      return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 500 });
    }

    let runs: Array<{ id: number; display_title?: string; run_name?: string; status?: string; conclusion?: string }> = [];
    try {
      const response = await githubFetch(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?event=repository_dispatch&per_page=100`);
      if (response.ok) {
        const data = await response.json();
        runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
      }
    } catch {
      runs = [];
    }

    const history = (jobs ?? []).map((job) => {
      const run = runs.find((item) =>
        item.display_title === `Clip Factory ${job.id}` || item.run_name === `Clip Factory ${job.id}`,
      );
      const status = !run
        ? "queued"
        : run.status !== "completed"
          ? "processing"
          : run.conclusion === "success"
            ? "completed"
            : run.conclusion === "cancelled"
              ? "canceled"
              : "failed";

      return {
        ...job,
        status,
        runId: run?.id ?? null,
        githubConclusion: run?.conclusion ?? null,
      };
    });

    return NextResponse.json({ history }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("History endpoint failed:", error);
    return NextResponse.json(
      { error: "Erro ao carregar histórico." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
