/**
 * LearnFlow Phase 3: Single-Question AI Mirroring Layer
 * VERSION: SOURCE BLOCK PIPELINE v0.5.3-BETA-DIAGNOSTIC
 *
 * STATUS:
 * - NEEDS VALIDATION.
 *
 * FIXES:
 * - Adds visible harvest diagnostics.
 * - Wraps harvest in try/catch so failures are shown.
 * - Removes lookbehind regex for browser compatibility.
 * - Keeps DOCX upload.
 * - Keeps Source Block Pipeline.
 * - Keeps Phase 3 mirror prompt preview.
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.5.3-BETA-DIAGNOSTIC";

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [globalTopic, setGlobalTopic] = useState("Chemistry");
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);
  const [diagnostics, setDiagnostics] = useState("");

  const normalize = (line) => String(line || "").replace(/\s+/g, " ").trim();

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
      setDiagnostics("DOCX loaded. Raw characters: " + String(result.value || "").length);
    } catch (err) {
      console.error("DOCX parse failed:", err);
      setDiagnostics("DOCX parse failed: " + err.message);
      alert("DOCX parse failed.");
    }
  }

  function extractAnswerKey(value) {
    const lines = value.split("\n");
    const clean = [];
    const key = {};
    let inKey = false;

    for (const line of lines) {
      const lower = normalize(line).toLowerCase();

      if (
        !inKey &&
        (
          lower === "answer key" ||
          lower === "answers" ||
          lower.startsWith("answer key:") ||
          lower.startsWith("key:")
        )
      ) {
        inKey = true;
        continue;
      }

      if (inKey) {
        const match = normalize(line).match(/^(\d{1,3})[.)]?\s*[-: ]?\s*([A-Ea-e*]{1,3})\b/);
        if (match) key[match[1]] = match[2].replace(/\*/g, "").toUpperCase();
        continue;
      }

      clean.push(line);
    }

    return { cleaned: clean.join("\n"), answerKey: key };
  }

  function isHeader(line) {
    const clean = normalize(line);

    if (/^\s*\d{1,3}[.)]\s+/.test(clean)) return false;

    return (
      /^part\s+(\d+|[ivx]+)\s*:/i.test(clean) ||
      /^section\s+([a-z]|\d+)\s*:/i.test(clean)
    );
  }

  function trimBeforeAssessmentStart(lines) {
    const partIndex = lines.findIndex(line =>
      /^part\s+(\d+|[ivx]+)\s*:/i.test(normalize(line))
    );

    if (partIndex >= 0) return lines.slice(partIndex + 1);

    return lines;
  }

  function isLikelyAnswerGridStart(lines, startIndex) {
    const window = lines.slice(startIndex, startIndex + 15).map(normalize);
    if (window.length < 6) return false;

    const shortLines = window.filter(line => line.length <= 4).length;
    const scantronTokens = window.filter(line =>
      /^\d{1,3}[.)]?$/.test(line) || /^[A-E]$/i.test(line)
    ).length;

    const hasSentence = window.some(line => line.length > 20 && /\s/.test(line));
    const hasQuestionWords = window.some(line =>
      /\b(which|what|why|how|calculate|determine|identify|explain|select|complete|classify|use|match)\b/i.test(line)
    );

    return (
      scantronTokens >= 4 &&
      shortLines >= window.length * 0.65 &&
      !hasSentence &&
      !hasQuestionWords
    );
  }

  function detectEndLineAnswer(rawText) {
    const clean = normalize(rawText);
    const match = clean.match(/^\d{1,3}[.)]\s+(.+?)\s+([A-Ea-e])$/);
    if (!match) return null;

    const stem = match[1].trim();
    const answer = match[2].toUpperCase();

    return stem.length >= 2 ? { stem, answer } : null;
  }

  function hasChoiceMarker(value) {
    return /(^|\s)[A-Ea-e][.)](\s|$)/.test(value);
  }

  function detectChoiceCount(rawText) {
    const matches = rawText.match(/(^|\s)[A-Ea-e][.)](\s|$)/g);
    return matches ? matches.length : 0;
  }

  function isQuestionStart(lines, i, started) {
    const line = lines[i];

    if (isHeader(line)) return false;
    if (isLikelyAnswerGridStart(lines, i)) return false;
    if (!/^\s*\d{1,3}[.)]\s+\S+/.test(line)) return false;

    if (started) return true;

    const nearby = lines.slice(i, i + 14).map(normalize).join(" ");

    return (
      /\?/.test(nearby) ||
      /\b(which|what|calculate|determine|identify|explain|select|write|draw|complete|classify|use|match|conclusion)\b/i.test(nearby) ||
      /_{3,}|☐/.test(nearby) ||
      hasChoiceMarker(nearby) ||
      detectEndLineAnswer(line)
    );
  }

  function detectType(rawText, choiceCount) {
    const lower = rawText.toLowerCase();

    if (
      /\b(graph|figure|diagram|image|chart|heating curve|cooling curve)\b/i.test(lower) ||
      /\bwhich segment\b/i.test(lower)
    ) {
      return "VISUAL_REQUIRED";
    }

    if (/\bselect\s+(all|multiple|two|three|four)\b/i.test(lower)) return "MULTI_SELECT";
    if (/drag|move|blank|_{3,}|☐|token bank|drop zone/i.test(lower)) return "INTERACTIVE";
    if (/matching|match each|column a|column b/i.test(lower)) return "MATCHING";
    if (detectEndLineAnswer(rawText) && choiceCount === 0) return "MATCHING";

    return choiceCount === 0 ? "FREE_RESPONSE" : "MULTIPLE_CHOICE";
  }

  function harvest() {
    try {
      const cleanedInput = cleanText(text);

      if (!cleanedInput) {
        setDiagnostics("Harvest stopped: no text loaded.");
        alert("No text loaded.");
        return;
      }

      const base = extractAnswerKey(cleanedInput);

      const allLines = base.cleaned
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      const assessmentLines = trimBeforeAssessmentStart(allLines);

      const groups = [];
      let current = null;
      let started = false;
      let stoppedAtGrid = false;

      for (let i = 0; i < assessmentLines.length; i++) {
        const line = assessmentLines[i];

        if (isLikelyAnswerGridStart(assessmentLines, i)) {
          stoppedAtGrid = true;
          break;
        }

        if (isHeader(line)) {
          if (current) groups.push(current);
          current = null;
          continue;
        }

        if (isQuestionStart(assessmentLines, i, started)) {
          started = true;
          if (current) groups.push(current);
          current = [line];
        } else if (current) {
          current.push(line);
        }
      }

      if (current) groups.push(current);

      const seen = new Set();

      const processed = groups.map(lines => {
        const rawText = lines.join("\n");
        const sourceNumber = String(lines[0] || "").match(/^\s*(\d{1,3})[.)]/)?.[1] || "?";
        const duplicate = seen.has(sourceNumber);
        seen.add(sourceNumber);

        const choiceCount = detectChoiceCount(rawText);
        const detectedType = detectType(rawText, choiceCount);
        const endLineAnswer = detectEndLineAnswer(rawText);

        const answerHint =
          base.answerKey[sourceNumber] ||
          endLineAnswer?.answer ||
          null;

        const status = duplicate
          ? "DUPLICATE"
          : detectedType === "VISUAL_REQUIRED"
            ? "NEEDS_GRAPHIC"
            : "READY_TO_MIRROR";

        return {
          sourceNumber,
          detectedType,
          status,
          rawText,
          answerHint,
          choiceCount,
          mirrorPayload: {
            intent: "Mirror assessment item",
            topicHint: globalTopic,
            source: rawText,
            originalNumber: sourceNumber,
            originalType: detectedType,
            answerHint,
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
      setIndex(0);
      setMode("Dashboard");

      setDiagnostics(
        "Harvest complete. Raw lines: " +
        allLines.length +
        " | Assessment lines: " +
        assessmentLines.length +
        " | Blocks: " +
        processed.length +
        " | Grid stopped: " +
        (stoppedAtGrid ? "yes" : "no")
      );
    } catch (err) {
      console.error("Harvest failed:", err);
      setDiagnostics("Harvest failed: " + err.message);
      alert("Harvest failed. Check diagnostics.");
    }
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

  const active = blocks[index];
  const mirrorPromptPreview = active ? generateMirrorPrompt(active) : "";

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

    diagnostics && React.createElement("div", {
      style: {
        background: "#fff8e1",
        border: "1px solid #f0c36d",
        padding: "10px",
        marginBottom: "15px",
        fontSize: "0.9rem"
      }
    }, diagnostics),

    !mode && React.createElement("div", null,
      React.createElement("input", {
        value: globalTopic,
        onChange: e => setGlobalTopic(e.target.value),
        style: { width: "100%", padding: "10px", marginBottom: "10px" },
        placeholder: "Topic Hint, e.g. Chemistry"
      }),

      React.createElement("input", {
        type: "file",
        accept: ".docx",
        onChange: handleFileUpload,
        style: { display: "block", marginBottom: "10px" }
      }),

      React.createElement("textarea", {
        value: text,
        onChange: e => setText(e.target.value),
        style: { width: "100%", height: "300px", padding: "10px", marginBottom: "10px" },
        placeholder: "Paste or upload document content..."
      }),

      React.createElement("button", {
        onClick: harvest,
        style: { padding: "10px 20px", background: "#007bff", color: "white", border: "none", cursor: "pointer" }
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
          }, mirrorPromptPreview)
        )
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
