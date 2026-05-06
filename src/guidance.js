export function buildButlerInfo(config) {
  return {
    name: "Butler",
    role: "AI Staff Member — Kasagi Labo / AnimeOshi",
    purpose: "Specialist operator for AnimeOshi data, analytics, research, translation, and planning tasks.",
    gateway: {
      default_target: config.defaultModel,
      mock_mode: config.mockButler,
    },
    how_this_mcp_guides_agents: [
      "Tool descriptions tell the connected agent when each tool should be used.",
      "butler_info gives identity, capabilities, and prompt patterns.",
      "butler_workflows gives task-specific examples and routing hints.",
      "butler_status and butler_ping help agents check readiness before delegating work.",
    ],
    recommended_flow: [
      "1. Call butler_status first when reliability matters.",
      "2. Call butler_workflows if you are unsure which capability fits.",
      "3. Use butler_chat with a stable caller_name for context continuity.",
      "4. Ask for specific source/tool usage: GA4, GSC, PostHog, backend DB, Japanese translation, GameTheory, or Simula.",
      "5. For operational work, delegate one concrete step at a time and ask Butler to confirm the result before sending the next step.",
      "6. Do not send large multi-step execution prompts as one blocking butler_chat call; they can time out and make status ambiguous.",
      "7. Use butler_reset_session if the conversation drifts or you need a clean context.",
    ],
    stepwise_delegation_rule: {
      summary: "Use Butler like an operator in a controlled handoff: one step, one confirmation, then continue.",
      do: [
        "Send a short request for the next specific action.",
        "Ask Butler to report the command/result/status for that action.",
        "Only proceed to the next action after confirming the previous one succeeded.",
        "For deploy/run/debug work, verify observable state after each change: process, port, HTTP status, JSON shape, logs, or git commit.",
      ],
      avoid: [
        "Do not ask Butler to pull, stop processes, start services, run checks, diagnose errors, and summarize everything in one long prompt.",
        "Do not assume work completed if butler_chat times out; send a short status-check prompt instead.",
        "Do not continue with dependent steps until Butler has confirmed the previous step.",
      ],
    },
    prompt_patterns: {
      analytics: "Use GA4/GSC/PostHog as appropriate. Include date range, metrics, filters, and a concise interpretation.",
      database: "Use the AnimeOshi backend database read-only. State the table/domain, desired fields, and aggregation.",
      translation: "Use Japanese translation tools. Preserve anime terminology, honorifics, tone, and glossary constraints.",
      strategy: "Use GameTheory/Simula to model incentives, scenarios, risks, and recommended moves.",
      operations: "Use stepwise delegation: ask Butler to do one concrete action, report the result, then wait for confirmation before the next action. If a write/destructive action is needed, ask Marcus for approval before executing.",
    },
    capabilities: [
      "Google Search Console — queries, pages, CTR, impressions, SEO opportunities",
      "GA4 — traffic, sessions, pageviews, acquisition, retention summaries",
      "PostHog — product events, funnels, cohorts, feature usage",
      "AnimeOshi backend database — read-only anime, episode, user, rating, enrichment data",
      "Japanese translation/localisation — anime-aware translation and tone refinement",
      "GameTheory — incentive analysis, competitor/user behavior strategy",
      "Simula — scenario modelling and what-if simulations",
      "Slack, Notion, web research, cron/reminders, and repo/code assistance where authorized",
    ],
    constraints: [
      "No DB writes without Marcus approval.",
      "No destructive server/repo operations without explicit approval.",
      "Credentials and secrets must never be exposed to remote agents.",
      "Prefer read-only analysis unless the user explicitly authorizes changes.",
    ],
  };
}

export function buildWorkflows() {
  return [
    {
      id: "animeoshi_backend_db",
      title: "AnimeOshi Backend Database",
      description: "Run read-only analysis over AnimeOshi backend data: anime, episodes, users, ratings, enrichment, and related metadata.",
      example: "Use the backend DB to find anime with high traffic but low episode rating coverage this month.",
      tags: ["database", "backend", "anime", "episodes", "ratings", "read-only"],
    },
    {
      id: "search_console_seo",
      title: "Google Search Console SEO Analysis",
      description: "Analyze queries, landing pages, impressions, CTR, position, and SEO opportunities for animeoshi.com.",
      example: "Use GSC to find pages with high impressions but CTR below 2% in the last 28 days.",
      tags: ["gsc", "seo", "search", "ctr", "impressions"],
    },
    {
      id: "ga4_analytics",
      title: "GA4 Traffic Analytics",
      description: "Fetch traffic, acquisition, pageview, session, and engagement trends from GA4.",
      example: "Use GA4 to compare organic traffic and engagement for anime pages week over week.",
      tags: ["ga4", "analytics", "traffic", "engagement"],
    },
    {
      id: "posthog_product_analytics",
      title: "PostHog Product Analytics",
      description: "Analyze product events, funnels, cohorts, retention, and feature usage.",
      example: "Use PostHog to inspect the episode_rated funnel and identify the biggest drop-off step.",
      tags: ["posthog", "events", "funnels", "cohorts", "retention"],
    },
    {
      id: "japanese_translation",
      title: "Japanese Translation and Localisation",
      description: "Translate or localize anime content while preserving tone, honorifics, title conventions, and domain terminology.",
      example: "Translate this episode overview to Japanese; preserve character names and use natural anime-review tone.",
      tags: ["japanese", "translation", "localisation", "anime"],
    },
    {
      id: "game_theory_strategy",
      title: "GameTheory Strategy Analysis",
      description: "Model incentives, player behavior, competitive moves, and strategic tradeoffs.",
      example: "Use GameTheory to evaluate whether public episode ratings or private recommendations create better user incentives.",
      tags: ["gametheory", "strategy", "incentives", "competition"],
    },
    {
      id: "simula_scenario_modeling",
      title: "Simula Scenario Modelling",
      description: "Run or design what-if simulations for growth, ranking, content, operations, and product decisions.",
      example: "Use Simula to model traffic impact if we enrich 500 top anime pages before next season starts.",
      tags: ["simula", "simulation", "forecast", "what-if"],
    },
    {
      id: "ai_enrichment_monitor",
      title: "AI Enrichment Pipeline Monitor",
      description: "Check daily enrichment, adult anime enrichment, SEO enrichment, and pipeline health.",
      example: "Check whether daily_run.py is healthy and summarize failed enrichment jobs.",
      tags: ["pipeline", "enrichment", "monitoring", "gcp"],
    },
    {
      id: "research_and_ops",
      title: "Research and Operations",
      description: "Use web research, Slack, Notion, reminders, and authorized repo help for operational tasks.",
      example: "Research competitor episode-rating UX, summarize findings, and draft a Notion note.",
      tags: ["web", "slack", "notion", "cron", "repos"],
    },
  ];
}