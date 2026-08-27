/**
 * Single source of truth for identity, education, and experience.
 *
 * This file drives the About page, the <head> structured data, AND the
 * generated resume PDF (see §5 of PLAN.md). Nothing here may be duplicated
 * as hand-written copy in a component — the whole point is that the site and
 * the PDF can never drift.
 */

export const profile = {
  name: "Marc Godbout-Chouinard",
  location: "Worcester, MA",
  email: "marcgc05@gmail.com",
  phone: "(508) 332-6836",
  links: {
    github: "https://github.com/mpchouinard",
    // TODO(marc): paste your LinkedIn URL — the resume links it but the PDF
    // stores it as an unresolvable relative link.
    linkedin: "",
  },
  tagline:
    "BS/MS student in AI at WPI. Retrieval-augmented generation research, applied ML systems, and the infrastructure that makes them reproducible.",
} as const;

export const education = [
  {
    institution: "Worcester Polytechnic Institute",
    degree: "BS in Computer Science, MS in Artificial Intelligence",
    start: "2023-08",
    end: "2027-05",
    expected: true,
    honors: [
      "GPA 3.90 / 4.0",
      "Dean's List (2023 – present)",
      "Presidential Scholarship",
    ],
    coursework: [
      "Software Engineering",
      "Machine Learning",
      "Intro to AI",
      "Algorithms",
      "Operating Systems",
      "Databases",
      "Software Security",
      "Cryptography",
      "Systems Programming",
      "Assembly Language",
    ],
  },
] as const;

export const experience = [
  {
    title: "RAG Model Researcher",
    org: "Worcester Polytechnic Institute",
    start: "2026-01",
    end: null, // present
    bullets: [
      "Worked with PhD students assessing medical Retrieval-Augmented Generation (RAG) systems for accuracy and reliability.",
      "Built and ran benchmarking workflows through SCT-Bench and a PubMed-based medical corpus from Hugging Face.",
      "Executed large-scale benchmarking jobs for medical RAG systems on WPI's Turing ARC cluster with Slurm.",
    ],
  },
  {
    title: "Remote Mathematics AI Trainer",
    org: "Outlier",
    start: "2023-01",
    end: "2025-12",
    bullets: [
      "Tailored and validated 200+ complex mathematical and logic-based prompts to benchmark LLM reasoning capabilities.",
      "Carried out in-depth assessments of AI technologies to ensure efficiency and user satisfaction.",
      "Collaborated with teams of AI trainers to maintain quality standards across training datasets.",
    ],
  },
  {
    title: "Research & Strategy Consultant",
    org: "Appalachian Mountain Club",
    start: "2025-01",
    end: "2025-12",
    bullets: [
      "Developed user stories and end-to-end stakeholder analysis of the Appalachian Mountain Club.",
      "Facilitated guided interviews and meetings with stakeholders at all levels — from executive leadership to staff and customers.",
      "Collaborated within a fast-moving Agile environment with strict report and deliverable deadlines.",
    ],
  },
  {
    title: "Code Sensei",
    org: "Code Ninjas",
    start: "2024-01",
    end: null,
    // TODO(marc): 2-3 real bullets. What ages do you teach, which languages,
    // roughly how many students? Deliberately EMPTY until you supply them —
    // the previous placeholder ("teaching programming fundamentals to
    // students") was invented copy and was shipping to the live page, which
    // CLAUDE.md §3 forbids. An empty role renders as title + dates only.
    bullets: [] as string[],
  },
] as const;

export const skills = {
  languages: ["Python", "Java", "TypeScript", "C", "C++", "C#", "SQL", "Assembly", "Bash", "HTML", "CSS"],
  frameworks: [
    "PyTorch",
    "Hugging Face",
    "scikit-learn",
    "LightGBM",
    "FastAPI",
    "Flask",
    "React",
    "Next.js",
    "SQLAlchemy",
    "Flask-Migrate",
    "pytest",
    "music21",
    "Tailwind",
    "Bootstrap",
    ".NET",
    "Azure OCR",
  ],
  tools: [
    "Git",
    "GitHub",
    "Docker",
    "AWS (EC2, RDS)",
    "Slurm",
    "PostgreSQL",
    "Linux",
    "Unity Engine",
    "Android SDK",
    "Agile",
    "Vim",
    "VS Code",
    "IntelliJ",
    "VirtualBox",
  ],
} as const;
