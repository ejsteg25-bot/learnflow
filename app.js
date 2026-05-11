/**
 * LearnFlow Phase 3: Single-Question AI Mirroring Layer
 * VERSION: SOURCE BLOCK PIPELINE v0.5.0-ALPHA-CORRECTED
 *
 * Changes:
 * - Preserves v0.4.5-UNIFIED parser behavior.
 * - Adds Phase 3 Mirror Prompt Preview.
 * - Adds Mirror Output placeholder area.
 * - Keeps DOCX upload visible and functional.
 * - Does NOT call an API yet.
 * - Does NOT expose API keys.
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.5.0-ALPHA-CORRECTED";

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [globalTopic, setGlobalTopic] = useState("Chemistry");
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);
  const [mirrorOutput, setMirrorOutput] = useState("");

  const normalize = (l) => String(l || "").replace(/\s+/g, " ").trim();

  function cleanText(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof mammoth === "undefined") {
      alert("Mammoth.js not detected.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      setText(result.value || "");
    } catch (err) {
      console.error(err);
      alert("DOCX parse failed.");
    }
  }

  function extractAnswerKey(text) {
    const lines = text.split("\n");
    const clean = [];
    const key = {};
    let inKey = false;

    for (const line of lines) {
      const l = normalize(line).toLowerCase();

      if (
        !inKey &&
        (
          l === "answer key" ||
          l === "answers" ||
          l.startsWith("answer key:") ||
          l.startsWith("key:")
        )
      ) {
        inKey = true;
        continue;
      }

      if (inKey) {
        const m = normalize(line).match(/^(\d{1,3})[.)]?\s*[-: ]?\s*([A-Ea-e*]{1,3})\b/);
        if (m) key[m[1]] = m[2].replace(/\*/g, "").toUpperCase();
        continue;
      }

      clean.push(line);
    }

    return { cleaned: clean.join("\n"), answerKey: key };
  }

  function isHeader(line) {
    const clean = normalize(line);
    return (
      /^part\s+(\d+|[ivx]+)\s*:/i.test(clean) ||
      /^section\s+([a-z]|\d+)\s*:/i.test(clean)
    );
  }

  function isLikelyAnswerGridStart(lines, startIndex) {
    const window = lines.slice(startIndex, startIndex + 15).map(normalize);
    if (window.length < 5) return false;

    const shortLines = window.filter(l => l.length <= 4).length;
    const scantronPatterns = window.filter(l =>
      /^\d{1,3}[.)]?$/.test(l) || /^[A-E]$/i.test(l)
    ).length;
    const hasSentences = window.some(l => l.length > 20 && /\s/.test(l));

    return scantronPatterns >= 3 && shortLines >= window.length * 0.7 && !hasSentences;
  }

  function isQuestionStart(lines, i, started) {
    const line = lines[i];

    if (!/^\s*\d{1,3}[.)]\s+\S+/.test(line)) return false;
    if (isLikelyAnswerGridStart(lines, i)) return false;

    if (started) return true;

    const clean = normalize(line);
    const nearby = lines.slice(i, i + 6).map(normalize).join(" ");

    return (
      /\?/.test(clean) ||
      /\b(which|what|calculate|determine|identify|explain|select|write|complete|classify|use|match)\b/i.test(clean) ||
      /_{3,}|☐/.test(clean) ||
      /(?<=^|\s)[A-E][.)](?=\s|$)/.test(nearby)
    );
  }

  function detectType(raw, choiceCount) {
    const lower = raw.toLowerCase();

    if (/graph|figure|diagram|image|segment|point|heating curve|cooling curve/i.test(lower)) {
      return "VISUAL_REQUIRED";
    }

    if (/\bselect\s+(all|multiple|two|three)\b/i.test(lower)) {
      return "MULTI_SELECT";
    }

    if (/drag|move|blank|_{3,}|☐/i.test(lower)) {
      return "INTERACTIVE";
    }

    if (/matching|column a|column b/i.test(lower)) {
      return "MATCHING";
    }

    return choiceCount === 0 ? "FREE_RESPONSE" : "MULTIPLE_CHOICE";
  }

  function harvest() {
    const { cleaned, answerKey } = extractAnswerKey(cleanText(text));
    const allLines = cleaned.split("\n").map(l => l.trim()).filter(Boolean);

    const groups = [];
    let current = null;
    let started = false;

    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];

      if (isLikelyAnswerGridStart(allLines, i)) break;

      const newQ = isQuestionStart(allLines, i, started);
      const header = isHeader(line);

      if (newQ || header) {
        if (current) groups.push(current);
        current = newQ ? [line] : null;
        if (newQ) started = true;
      } else if (current) {
        current.push(line);
      }
    }

    if (current) groups.push(current);

    const seen = new Set();

    const processed = groups.map(lines => {
      const raw = lines.join("\n");
      const num = String(lines[0] || "").match(/^\s*(\d{1,3})[.)]/)?.[1] || "?";
      const duplicate = seen.has(num);
      seen.add(num);

      const choiceCount = [...raw.matchAll(/(?<=^|\s)[A-E][.)](?=\s|$)/g)].length;
      const type = detectType(raw, choiceCount);

      const status = duplicate
        ? "DUPLICATE"
        : type === "VISUAL_REQUIRED"
          ? "NEEDS_GRAPHIC"
          : "READY_TO_MIRROR";

      return {
        sourceNumber: num,
        detectedType: type,
        status,
        rawText: raw,
        mirrorPayload: {
          intent: "Mirror assessment item",
          topicHint: globalTopic,
          source: raw,
          originalNumber: num,
          originalType: type,
          answerHint: answerKey[num] || null,
          constraints: {
            preserveConcept: true,
            preserveDOK: true,
            preserveQuestionType: true,
            cleanStudentReady: true,
            doNotUseOutsideConcepts: true,
            flagIfAmbiguousOrIncomplete: true
          }
        }
      };
    });

    setBlocks(processed);
    setMode("Dashboard");
    setIndex(0);
    setMirrorOutput("");
  }

  function generateMirrorPrompt(block) {
    const payload = block.mirrorPayload;

    return `
ROLE:
You are an expert high school chemistry assessment designer.

TASK:
Create one mirrored version of the source assessment item.

SOURCE CONTROL RULE:
Use only the instructional concept, structure, rigor, and constraints present in the source item.
Do not introduce outside concepts.
Do not simplify the item.
Do not increase or decrease the Depth of Knowledge.

MIRRORING RULES:
1. Preserve the original question type: ${payload.originalType}.
2. Preserve the same skill and reasoning demand.
3. Change surface details such as names, substances, numbers, or scenario context when appropriate.
4. Keep all chemistry scientifically valid.
5. If the source is incomplete, ambiguous, missing a visual, or impossible to mirror safely, return NEEDS_TEACHER_REVIEW with a reason.
6. If the item requires a graph, image, diagram, table, segment, or figure, do not invent the visual. Return NEEDS_TEACHER_REVIEW unless enough source context is present.
7. If answer choices exist, create parallel answer choices and identify the correct answer.
8. If the item is interactive or fill-in-the-blank, preserve that format.
9. If the item is multi-select, preserve multi-select behavior.
10. Do not include scantron instructions, formatting artifacts, or document noise.

OUTPUT FORMAT:
{
  "status": "MIRRORED" or "NEEDS_TEACHER_REVIEW",
  "mirroredQuestion": "...",
  "answerChoices": [],
  "correctAnswer": "...",
  "teacherReviewReason": null,
  "notes": "Brief explanation of how the mirror preserves the source."
}

MIRROR PAYLOAD:
${JSON.stringify(payload, null, 2)}
`.trim();
  }

  function previewMirror() {
    const active = blocks[index];
    if (!active) return;

    const prompt = generateMirrorPrompt(active);
    setMirrorOutput(prompt);
  }

  const active = blocks[index];

  return React.createElement("div", {
    style: {
      padding: "40px",
      fontFamily: "sans-serif",
      maxWidth: "1100px",
      margin: "auto"
    }
  },

    React.createElement("h1", { style: { color: "#007bff" } }, "LearnFlow Phase 3"),
    React.createElement("p", { style: { fontSize: "0.8rem", color: "#666" } }, APP_VERSION),

    !mode && React.createElement("div", null,
      React.createElement("input", {
        value: globalTopic,
        onChange: e => setGlobalTopic(e.target.value),
        style: {
          width: "100%",
          padding: "10px",
          marginBottom: "10px"
        },
        placeholder: "Topic Hint, e.g. Chemistry"
      }),

      React.createElement("input", {
        type: "file",
        accept: ".docx",
        onChange: handleFileUpload,
        style: {
          display: "block",
          marginBottom: "10px"
        }
      }),

      React.createElement("textarea", {
        value: text,
        onChange: e => setText(e.target.value),
        style: {
          width: "100%",
          height: "300px",
          padding: "10px",
          marginBottom: "10px"
        },
        placeholder: "Paste or upload document content..."
      }),

      React.createElement("button", {
        onClick: harvest,
        style: {
          padding: "10px 20px",
          background: "#007bff",
          color: "white",
          border: "none",
          cursor: "pointer"
        }
      }, "Harvest Source")
    ),

    mode === "Dashboard" && React.createElement("div", null,
      React.createElement("button", {
        onClick: () => setMode(null),
        style: { marginBottom: "20px" }
      }, "Back to Editor"),

      blocks.map((block, i) =>
        React.createElement("div", {
          key: i,
          style: {
            padding: "10px",
            borderBottom: "1px solid #eee",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }
        },
          React.createElement("span", null,
            `Q${block.sourceNumber} | ${block.detectedType} | `,
            React.createElement("span", {
              style: {
                color:
                  block.status === "READY_TO_MIRROR"
                    ? "green"
                    : block.status === "NEEDS_GRAPHIC"
                      ? "orange"
                      : "red",
                fontWeight: "bold"
              }
            }, block.status)
          ),

          React.createElement("button", {
            onClick: () => {
              setIndex(i);
              setMode("Review");
              setMirrorOutput("");
            }
          }, "Review & Mirror")
        )
      )
    ),

    mode === "Review" && active && React.createElement("div", null,
      React.createElement("button", {
        onClick: () => setMode("Dashboard"),
        style: { marginBottom: "20px" }
      }, "Back to Dashboard"),

      React.createElement("h2", null, `Question ${active.sourceNumber}`),

      React.createElement("button", {
        onClick: previewMirror,
        disabled: active.status !== "READY_TO_MIRROR",
        style: {
          marginBottom: "20px",
          padding: "12px 20px",
          background: active.status === "READY_TO_MIRROR" ? "#28a745" : "#999",
          color: "white",
          border: "none",
          cursor: active.status === "READY_TO_MIRROR" ? "pointer" : "not-allowed"
        }
      }, "Generate Mirror Prompt Preview"),

      React.createElement("div", {
        style: {
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "20px"
        }
      },
        React.createElement("div", null,
          React.createElement("h3", null, "Original Source"),
          React.createElement("pre", {
            style: {
              background: "#f8f9fa",
              padding: "15px",
              whiteSpace: "pre-wrap",
              border: "1px solid #ddd"
            }
          }, active.rawText),

          React.createElement("h3", null, "Mirror Payload"),
          React.createElement("pre", {
            style: {
              background: "#eef",
              padding: "15px",
              whiteSpace: "pre-wrap",
              border: "1px solid #ccd"
            }
          }, JSON.stringify(active.mirrorPayload, null, 2))
        ),

        React.createElement("div", null,
          React.createElement("h3", null, "Mirroring Prompt Preview"),
          React.createElement("pre", {
            style: {
              background: "#f5fff5",
              padding: "15px",
              whiteSpace: "pre-wrap",
              border: "1px solid #b5ddb5",
              minHeight: "300px"
            }
          }, mirrorOutput || "No mirror prompt generated yet.")
        )
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
