// The agents Amun offers from the first day (owner's list, 13 November 2026).
// Each entry carries what the agent owns, what it produces and the frameworks
// it works from, so the same record can brief the agent and describe it.

export interface AgentProfile {
  /** Name shown to the user and used for @mentions. */
  name: string;
  /** One line for a card. */
  summary: string;
  /** What it owns. */
  scope: string;
  /** Key workflows and outputs. */
  outputs: string;
  /** Frameworks and templates it works from: [name, link]. */
  frameworks: readonly (readonly [string, string])[];
  /** Avatar file under the renderer's avatars folder (CC0, Animoon). */
  avatar: string;
  /** The same animal is reused for a few agents, mirrored. */
  mirrored?: true;
}

export const agentCatalog: readonly AgentProfile[] = [
  {
    name: "Research & Insights",
    summary: "Market, customer and competitor research with sources",
    scope:
      "Market, customer, competitor, industry, technology, and regulatory research; client intelligence; source-backed synthesis",
    outputs:
      "Market scans, competitor teardowns, TAM/SAM/SOM sizing, trend briefs, client profiles, regulatory briefs, research synthesis with citations",
    frameworks: [
      [
        "TAM/SAM/SOM sizing",
        "https://www.productplan.com/glossary/tam-sam-som/",
      ],
      [
        "Porter’s Five Forces",
        "https://www.isc.hbs.edu/strategy/business-strategy/Pages/the-five-forces.aspx",
      ],
      [
        "PESTLE",
        "https://www.corporatefinanceinstitute.com/resources/management/pestle-analysis/",
      ],
      ["JTBD Forces of Progress", "https://www.jtbd.info/"],
      [
        "Competitive Teardown / Parity Matrix",
        "https://www.productplan.com/glossary/competitive-analysis/",
      ],
    ],
    avatar: "giraffe",
  },
  {
    name: "Product Manager",
    summary: "Strategy, discovery, requirements, roadmap and backlog",
    scope:
      "End-to-end product management: strategy, discovery, requirements, roadmap, backlog, prioritization, business case",
    outputs:
      "Problem framing, discovery synthesis, ideation, opportunity validation, product vision, roadmap, PRFAQ, PRD, user stories, acceptance criteria, backlog grooming, prioritization",
    frameworks: [
      [
        "Amazon Working Backwards PR/FAQ",
        "https://www.productplan.com/glossary/working-backwards/",
      ],
      [
        "Opportunity Solution Tree",
        "https://www.producttalk.org/opportunity-solution-tree/",
      ],
      ["RICE", "https://www.intercom.com/blog/rice-scoring-prioritization/"],
      ["MoSCoW", "https://www.agilealliance.org/glossary/moscow/"],
      ["INVEST", "https://www.agilealliance.org/glossary/invest/"],
      [
        "Given-When-Then (Gherkin)",
        "https://cucumber.io/docs/gherkin/reference/",
      ],
      ["Shape Up Pitch", "https://basecamp.com/shapeup"],
      [
        "Agile PRD",
        "https://www.productplan.com/glossary/product-requirements-document-prd/",
      ],
    ],
    avatar: "lion",
  },
  {
    name: "UX",
    summary: "Journeys, personas, wireframes, prototypes and brand",
    scope:
      "Senior Product Designer scope: branding, colors, UI, UX, journey maps, service blueprints, pain-point analysis, personas, experience audits, CX opportunities, wireframes, visual prototypes",
    outputs:
      "Journey maps, service blueprints, personas, experience audits, IA, user flows, wireframes, visual prototypes, design-system guidance, accessibility checks",
    frameworks: [
      [
        "Double Diamond",
        "https://www.designcouncil.org.uk/our-resources/framework-for-innovation/design-councils-double-diamond/",
      ],
      [
        "Journey Mapping",
        "https://www.nngroup.com/articles/journey-mapping-101/",
      ],
      [
        "Service Blueprints",
        "https://www.nngroup.com/articles/service-blueprints-definition/",
      ],
      [
        "Nielsen 10 Usability Heuristics",
        "https://www.nngroup.com/articles/ten-usability-heuristics/",
      ],
      [
        "System Usability Scale (SUS)",
        "https://www.usability.gov/what-and-why/glossary/system-usability-scale-sus.html",
      ],
      ["WCAG 2.2", "https://www.w3.org/WAI/standards-guidelines/wcag/"],
      ["Atomic Design", "https://bradfrost.com/blog/post/atomic-web-design/"],
      ["OOUX", "https://www.ouxx.com/"],
    ],
    avatar: "toucan",
  },
  {
    name: "Content",
    summary: "Social posts, scripts, website copy and content strategy",
    scope:
      "All content creation and content strategy: social, product marketing content, hooks, scripts, website content, IA, UX content research",
    outputs:
      "Social posts, hooks, scripts, landing-page copy, website content, UX microcopy, content calendars, SEO briefs, information architecture, content research",
    frameworks: [
      ["Hook-Story-Offer", "https://www.dotcomsecrets.com/"],
      [
        "Before-After-Bridge (BAB)",
        "https://www.copyblogger.com/copywriting-formula/",
      ],
      ["StoryBrand SB7", "https://storybrand.com/"],
      ["1-3-1 Social Structure", "https://www.justinwelsh.me/"],
      ["4 Cs of UX Writing", "https://www.nngroup.com/articles/ux-writing/"],
      [
        "Landing Page Copy Deck",
        "https://www.unbounce.com/landing-page-articles/landing-page-copywriting/",
      ],
      ["UX Microcopy Matrix", "https://www.nngroup.com/articles/microcopy/"],
    ],
    avatar: "redpanda",
  },
  {
    name: "Product Marketing",
    summary: "Positioning, messaging, battlecards and sales enablement",
    scope:
      "GTM, sales enablement, competitive positioning, customer voice, pricing/revenue narrative, P&L input, market demand",
    outputs:
      "Positioning & messaging, value proposition, competitive battlecards, sales enablement kits, customer success case studies (STAR), white papers, pricing/packaging input, revenue/P&L narrative, customer feedback synthesis",
    frameworks: [
      ["April Dunford Positioning", "https://www.aprildunford.com/"],
      [
        "Value Proposition Canvas",
        "https://www.strategyzer.com/library/the-value-proposition-canvas",
      ],
      ["Message House", "https://www.messagehouse.org/"],
      ["MEDDPICC", "https://www.meddicc.com/"],
      [
        "STAR Case Study",
        "https://www.themuse.com/advice/star-interview-method",
      ],
      [
        "Competitive Sales Battlecard",
        "https://www.gong.io/blog/sales-battlecard/",
      ],
      [
        "Van Westendorp Price Sensitivity",
        "https://www.qualtrics.com/experience-management/research/price-sensitivity/",
      ],
      [
        "Good-Better-Best Packaging",
        "https://www.priceintelligently.com/blog/bidirectional-pricing",
      ],
    ],
    avatar: "kangaroo",
  },
  {
    name: "Solution & AI Architecture",
    summary: "Solution design, integrations, data and AI architecture",
    scope:
      "Technical solution design, integrations, data, AI/agent architecture, security, nonfunctional requirements",
    outputs:
      "Architecture options, C4 diagrams, data models, integration design, NFRs, AI use-case feasibility, agent design, evaluation criteria, security/governance requirements",
    frameworks: [
      ["C4 Model", "https://c4model.com/"],
      ["TOGAF ADM", "https://www.opengroup.org/togaf"],
      ["ATAM", "https://www.sei.cmu.edu/"],
      ["NIST AI RMF", "https://www.nist.gov/itl/ai-risk-management-framework"],
      [
        "OWASP LLM Top 10",
        "https://owasp.org/www-project-top-10-for-large-language-model-applications/",
      ],
      [
        "Technical Solution Architecture Document (SAD)",
        "https://www.arc42.org/",
      ],
    ],
    avatar: "orca",
  },
  {
    name: "Proposal & Bid",
    summary: "RFP intake through submission and orals",
    scope:
      "Formal pursuit lifecycle: RFP/RFI intake through submission and orals",
    outputs:
      "RFP intake, requirement matrix, bid/no-bid, proposal strategy, proposal drafting, pricing support, SOW drafting, compliance checks, orals prep",
    frameworks: [
      ["RFP Compliance Matrix", "https://www.rfp360.com/"],
      ["Shipley Proposal Framework", "https://www.shipleywins.com/"],
      ["APMP Body of Knowledge", "https://www.apmp.org/"],
      [
        "SOW Template",
        "https://www.atlassian.com/agile/project-management/statement-of-work",
      ],
      ["Orals Prep", "https://www.apmp.org/"],
    ],
    avatar: "leopard",
  },
  {
    name: "Presales & Solutioning",
    summary: "Demos, proofs of concept and technical answers",
    scope: "Solution shaping, demos, PoCs, technical Q&A, objection handling",
    outputs:
      "Discovery-call synthesis, solution options, demo scripts, PoC plans, technical Q&A, objection handling, proof-of-concept SOW",
    frameworks: [
      ["MEDDPICC", "https://www.meddicc.com/"],
      ["Challenger Sale", "https://challengerinc.com/"],
      ["Demo Script", "https://www.gong.io/blog/sales-demo/"],
      [
        "PoC SOW",
        "https://www.atlassian.com/agile/project-management/statement-of-work",
      ],
      ["Technical RFP Response", "https://www.rfp360.com/"],
    ],
    avatar: "hyena",
  },
  {
    name: "Sales Intelligence",
    summary: "Pipeline, accounts, meetings and next-best actions",
    scope:
      "Pipeline, accounts, leads, meetings, CRM hygiene, next-best actions",
    outputs:
      "Lead qualification, account research, stakeholder mapping, meeting summaries, CRM hygiene, pipeline commentary, next-best actions",
    frameworks: [
      ["BANT", "https://www.hubspot.com/sales/bant"],
      ["MEDDIC", "https://www.meddicc.com/"],
      [
        "Account Planning",
        "https://www.gartner.com/en/sales/insights/account-planning",
      ],
      [
        "Meeting Intelligence",
        "https://www.gong.io/blog/meeting-intelligence/",
      ],
    ],
    avatar: "wolf",
  },
  {
    name: "Engagement Delivery & PMO",
    summary: "Plans, status reports, risks and executive updates",
    scope:
      "Delivery execution, governance, reporting, risk, dependencies, executive updates",
    outputs:
      "Project plans, status reports, RAID logs, action tracking, dependency management, delivery-health dashboards, executive BLUF updates",
    frameworks: [
      ["RACI", "https://asana.com/resources/raci-chart"],
      ["DACI", "https://www.atlassian.com/agile/decision-making/daci"],
      ["Cynefin", "https://thecynefin.co/"],
      ["PMBOK", "https://www.pmi.org/pmbok-guide-standards"],
      ["Scrum Guide", "https://scrumguides.org/"],
      ["Kanban", "https://www.atlassian.com/agile/kanban"],
      ["BLUF Executive Update", "https://www.army.mil/article/24038/"],
      [
        "Delivery Risk Register",
        "https://www.pmi.org/learning/library/risk-register-project-management-7071",
      ],
    ],
    avatar: "penguin",
  },
  {
    name: "Client Success",
    summary: "Adoption, health, renewals and churn prevention",
    scope: "Adoption, activation, health, renewal, expansion, churn prevention",
    outputs:
      "Onboarding funnels, activation tracking, health scores, QBR prep, renewal risk, expansion opportunities, churn interventions",
    frameworks: [
      ["Customer Health Score", "https://www.gainsight.com/"],
      ["NPS", "https://www.netpromoter.com/know/"],
      ["AARRR (Pirate Metrics)", "https://www.500.co/blog/aarrr-framework/"],
      ["Product-Led Growth Flywheel", "https://www.productled.com/"],
      ["Onboarding Funnel / Aha! Blueprint", "https://www.productled.com/"],
      ["Churn Prevention Playbook", "https://www.churnzero.com/"],
    ],
    avatar: "koala",
  },
  {
    name: "Knowledge & Reuse",
    summary: "Finds and reuses past proposals, decks and lessons",
    scope:
      "Firm-wide knowledge retrieval, reuse, lessons learned, template governance",
    outputs:
      "Search across proposals, case studies, decks, SOPs, lessons learned; curated knowledge packs; template governance; answer with citations",
    frameworks: [
      [
        "Retrieval-Augmented Generation (RAG)",
        "https://www.ibm.com/topics/retrieval-augmented-generation",
      ],
      ["Knowledge Management", "https://www.apqc.org/"],
      [
        "Lessons Learned",
        "https://www.pmi.org/learning/library/lessons-learned-project-management-8107",
      ],
      ["Template Governance", "https://www.apqc.org/"],
    ],
    avatar: "turtle",
  },
  {
    name: "QA",
    summary: "Test plans, test cases, defect triage and release gates",
    scope: "Quality assurance, testing, defect management, release gates",
    outputs:
      "Test strategy, test plans, test cases, defect triage, release gates, regression suites",
    frameworks: [
      [
        "Test Pyramid",
        "https://martinfowler.com/articles/practical-test-pyramid.html",
      ],
      ["ISTQB", "https://www.istqb.org/"],
      [
        "Boundary Value Analysis",
        "https://www.testrail.com/resources/blog/boundary-value-analysis/",
      ],
      [
        "Equivalence Partitioning",
        "https://www.testrail.com/resources/blog/equivalence-partitioning/",
      ],
      [
        "P0-P3 Defect Severity",
        "https://www.atlassian.com/software/jira/guides/defect-tracking",
      ],
    ],
    avatar: "panda",
  },
  {
    name: "Commercial & Legal Operations",
    summary: "Contracts, margins, obligations and renewals",
    scope: "Commercial economics, contracts, legal risk, renewals, obligations",
    outputs:
      "Pipeline economics, margin, utilization, scope creep, pricing leakage, contract summaries, obligation extraction, renewal alerts, NDA/DPA triage",
    frameworks: [
      ["Rule of 40", "https://www.bvp.com/atlas/rule-of-40"],
      ["Contract Lifecycle Management", "https://www.iaccm.com/"],
      ["CLM", "https://www.ironclad.com/"],
      ["Legal Intake", "https://www.iapp.org/"],
      ["Margin & Profitability", "https://www.afponline.org/"],
    ],
    avatar: "rhinoceros",
  },
  {
    name: "Finance & Performance",
    summary: "Budgets, forecasts, variance and management reports",
    scope: "Financial planning, analysis, forecasting, reporting",
    outputs:
      "Budgets, forecasts, variance analysis, revenue/cost analysis, scenario modeling, management reporting",
    frameworks: [
      ["FP&A", "https://www.afponline.org/"],
      ["Driver-Based Budgeting", "https://www.planful.com/"],
      [
        "Scenario Planning",
        "https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights",
      ],
      ["Management Reporting", "https://www.afponline.org/"],
    ],
    avatar: "polarbear",
  },
  {
    name: "HR",
    summary: "Hiring, onboarding, performance, learning and policy",
    scope:
      "Employee lifecycle: talent acquisition, onboarding, performance, learning, policy",
    outputs:
      "Role profiles, candidate screening, interview guides, onboarding, policy answers, performance-review support, learning paths",
    frameworks: [
      ["SHRM", "https://www.shrm.org/"],
      ["Competency Frameworks", "https://www.shrm.org/"],
      ["Onboarding", "https://www.shrm.org/"],
      [
        "Performance Management",
        "https://www.gartner.com/en/human-resources/insights/performance-management",
      ],
      ["Learning Paths", "https://www.shrm.org/"],
    ],
    avatar: "gorilla",
  },
  {
    name: "Procurement & Vendor",
    summary: "Vendor research, RFQs, comparisons and approvals",
    scope: "External spend, suppliers, contracts, approvals",
    outputs:
      "Vendor research, RFQ/RFP drafting, comparison matrices, contract summaries, approval tracking",
    frameworks: [
      ["Category Management", "https://www.cips.org/"],
      [
        "Total Cost of Ownership",
        "https://www.investopedia.com/terms/t/totalcostofownership.asp",
      ],
      ["Vendor Scorecard", "https://www.cips.org/"],
      ["Procurement RFP", "https://www.cips.org/"],
    ],
    avatar: "zebra",
  },
  {
    name: "Risk & Compliance",
    summary: "Risk registers, controls, audits and remediation",
    scope: "Operational, regulatory, security, and audit risk",
    outputs:
      "Risk registers, control monitoring, policy exceptions, audit evidence, compliance questionnaires, remediation plans",
    frameworks: [
      ["ISO 31000", "https://www.iso.org/iso-31000-risk-management.html"],
      ["COSO ERM", "https://www.coso.org/"],
      ["NIST CSF", "https://www.nist.gov/cyberframework"],
      ["SOC 2", "https://www.aicpa-cima.com/"],
      ["Privacy by Design", "https://www.iso.org/standard/76570.html"],
    ],
    avatar: "wolf",
    mirrored: true,
  },
  {
    name: "Desktop Support",
    summary: "IT help, access requests and ticket triage for staff",
    scope: "Internal employee IT support across HR, IT, finance, facilities",
    outputs:
      "Policy Q&A, ticket triage, access requests, device/software support, expense guidance, escalation routing",
    frameworks: [
      ["ITIL", "https://www.axelos.com/certifications/itil-service-management"],
      ["ITSM", "https://www.servicenow.com/"],
      ["SLA", "https://www.atlassian.com/itsm/service-level-agreements"],
      ["Ticket Triage", "https://www.atlassian.com/itsm"],
    ],
    avatar: "koala",
    mirrored: true,
  },
  {
    name: "Product Analytics & Experimentation",
    summary: "Funnels, cohorts, A/B tests and the North Star metric",
    scope:
      "Product analytics, experimentation, instrumentation, funnel/retention analysis",
    outputs:
      "Event tracking, funnels, cohorts, A/B tests, North Star metric, experimentation briefs, product analytics dashboards",
    frameworks: [
      [
        "Amplitude North Star Metric",
        "https://www.amplitude.com/blog/north-star-metric",
      ],
      ["HEART Framework", "https://research.google/pubs/pub35529/"],
      ["AARRR", "https://www.500.co/blog/aarrr-framework/"],
      [
        "Scientific A/B Testing",
        "https://www.optimizely.com/optimization-glossary/ab-testing/",
      ],
      ["Event Tracking Spec", "https://www.amplitude.com/blog/event-tracking"],
    ],
    avatar: "giraffe",
    mirrored: true,
  },
];

/** The catalogue entry for an agent's name, if it is one of Amun's own. */
export function agentProfile(name: string) {
  const wanted = name.trim().toLowerCase();
  return agentCatalog.find((agent) => agent.name.toLowerCase() === wanted);
}
