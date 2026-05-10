/**
 * LearnFlow Phase 2B.1: Hardened Source Block Pipeline
 * VERSION: 0.3.4-STABLE
 * Changes:
 * - Fixes active variable stability in render.
 * - Maintains end-of-line answer detection for shorthand matching.
 * - Supports A-E shorthand answers.
 * - Preserves full source blocks for AI mirroring.
 */

const { useState } = React;

const APP_VERSION = "VERSION: SOURCE BLOCK PIPELINE v0.3.4-STABLE";

function App() {
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [globalTopic, setGlobalTopic] = useState("Chemistry");
  const [mode, setMode] = useState(null);
  const [index, setIndex] = useState(0);

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
      console.error("File processing error:", err);
      alert("Failed to parse .docx file.");
    }
  }

  const normalizeLine = (l) => String(l || "").replace(/\s+/g, " ").trim();

  function cleanText(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function extractAnswerKeyAndCleanText(value) {
    const lines = value.split("\n");
    const kept = [];
    const answerKey = {};
    let inAnswerKey = false;

    for (const line of lines) {
      const clean = normalizeLine(line);
      const lower = clean.toLowerCase();

      if (
        !inAnswerKey &&
        (
          lower === "answer key" ||
          lower === "answers" ||
          lower.startsWith("answer key:") ||
          lower.startsWith("key:")
        )
      ) {
        inAnswerKey = true;
        continue;
      }

      if (inAnswerKey) {
        const keyMatch = clean.match(/^(\d{1,3})[.)]?\s*[-: ]?\s*([A-Ea-e*]{1,3})\b/);
        if (keyMatch) {
          answerKey[keyMatch[1]] = keyMatch[2].replace(/\*/g, "").toUpperCase();
        }
        continue;
      }

      kept.push(line);
    }

    return { cleanedText: kept.join("\n"), answerKey };
  }

  const isQuestionStart = (line) => /^\s*\d{1,3}[.)]\s+\S+/.test(line);

  const getQuestionNumber = (line) =>
    String(line || "").match(/^\s*(\d{1,3})[.)]\s+/)?.[1] || "?";

  const removeQuestionNumber = (line) =>
    String(line || "").replace(/^\s*\d{1,3}[.)]\s+/, "").trim();

  function detectChoiceEvidence(rawText) {
    const matches = [...rawText.matchAll(/[A-Ea-e][.)]+\s*/g)];
    const gluedChoiceLikely = /[A-Za-z0-9%)](?=[B-Eb-e][.)]\s*)/.test(rawText);
    return { count: matches.length, gluedChoiceLikely };
  }

  function detectEndLineAnswer(rawText) {
    const clean = normalizeLine(rawText);
    const match = clean.match(/^\d{1,3}[.)]\s+(.+?)\s+([A-Ea-e])$/);

    if (!match) return null;

    const stem = match[1].trim();
    const answer = match[2].toUpperCase();

    return stem.length >= 2 ? { stem, answer } : null;
  }

  function detectAnswerHint(rawText, externalAnswer) {
    if (externalAnswer) return externalAnswer;

    const answerLine = rawText.match(/answer\s*[:\-]?\s*([A-Ea-e])\b/i);
    if (answerLine) return answerLine[1].toUpperCase();

    const starMatch = rawText.match(/\b([A-Ea-e])[\.)]?[^\n]*\*{2,3}/);
    if (starMatch) return starMatch[1].toUpperCase();

    const endLine = detectEndLineAnswer(rawText);
    return endLine ? endLine.answer : null;
  }

  function detectType(rawText, choiceCount) {
    const lower = rawText.toLowerCase();

    if (detectEndLineAnswer(rawText) && choiceCount === 0) return "MATCHING";
    if (/graph|figure|diagram|chart|image|look at|insert graphic/i.test(rawText)) return "VISUAL_REQUIRED";
    if (/\bselect\s+(two|three|four|all|multiple)\b/i.test(lower)) return "MULTI_SELECT";
    if (/drag|move|token|blank|_{3,}/i.test(lower)) return "INTERACTIVE";
    if (/matching|column a|column b/i.test(lower)) return "MATCHING";
    if (/free response|write|explain|essay|draw/i.test(lower)) return "FREE_RESPONSE";

    return choiceCount === 0 ? "FREE_RESPONSE" : "MULTIPLE_CHOICE";
  }

  function buildPromptGuess(lines) {
    const first = removeQuestionNumber(lines[0] || "");
    const extra = [];

    for (const line of lines.slice(1)) {
      const clean = normalizeLine(line);

      if (!clean) continue;
      if (/^[A-Ea-e][.)]+/.test(clean)) break;
      if (/^answer\s*:?/i.test(clean)) break;

      extra.push(clean);
      if (extra.length >= 2) break;
    }

    return [first, ...extra].join(" ").trim();
  }

  function harvest() {
    const cleaned = cleanText(text);
    const { cleanedText, answerKey } = extractAnswerKeyAndCleanText(cleaned);

    const rawLines = cleanedText
      .split("\n")
      .map(l => l.trim())
      .filter(l => l);

    const groups = [];
    let current = null;

    rawLines.forEach(line => {
      if (isQuestionStart(line)) {
        if (current) groups.push(current);
        current = [line];
      } else if (current) {
        current.push(line);
      }
    });

    if (current) groups.push(current);

    const seenNumbers = new Set();

    const processed = groups.map(lines => {
      const rawText = lines.join("\n");
      const num = getQuestionNumber(lines[0]);
      const duplicate = seenNumbers.has(num);
      seenNumbers.add(num);

      const evidence = detectChoiceEvidence(rawText);
      const type = detectType(rawText, evidence.count);
      const promptGuess = buildPromptGuess(lines);
      const answerHint = detectAnswerHint(rawText, answerKey[num]);

      let confidence = "HIGH";

      if (!promptGuess || promptGuess.length < 3) {
        confidence = "LOW";
      } else if (type === "VISUAL_REQUIRED") {
        confidence = "MEDIUM";
      } else if (type === "MATCHING" && answerHint) {
        confidence = "HIGH";
      } else if (
        evidence.gluedChoiceLikely ||
        (type === "MULTIPLE_CHOICE" && evidence.count < 3)
      ) {
        confidence = "MEDIUM";
      }

      const status = duplicate
        ? "DUPLICATE"
        : type === "VISUAL_REQUIRED"
          ? "NEEDS_GRAPHIC"
          : confidence === "LOW"
            ? "NEEDS_TEACHER_REVIEW"
            : "READY_TO_MIRROR";

      return {
        sourceNumber: num,
        detectedType: type,
        confidence,
        status,
        promptGuess,
        rawText,
        answerHint,
        mirrorPayload: {
          intent: "Mirror assessment item",
          topicHint: globalTopic,
          source: rawText,
          originalNumber: num,
          answerHint
        }
      };
    });

    setBlocks(processed);
    setIndex(0);
    setMode("Dashboard");
  }

  const active = blocks[index];

  return React.createElement(
    "div",
    {
      style: {
        padding: "40px",
        fontFamily: "sans-serif",
        maxWidth: "1000px",
        margin: "auto"
      }
    },

    React.createElement("h1", { style: { color: "#007bff" } }, "LearnFlow Pipeline"),
    React.createElement("p", { style: { fontSize: "0.8rem", color: "#888" } }, APP_VERSION),

    !mode && React.createElement(
      "div",
      null,
      React.createElement("input", {
        value: globalTopic,
        onChange: e => setGlobalTopic(e.target.value),
        style: {
          width: "100%",
          padding: "10px",
          marginBottom: "10px"
        }
      }),
      React.createElement("input", {
        type: "file",
        onChange: handleFileUpload,
        style: {
          marginBottom: "10px",
          display: "block"
        }
      }),
      React.createElement("textarea", {
        value: text,
        onChange: e => setText(e.target.value),
        style: {
          width: "100%",
          height: "300px",
          padding: "10px"
        },
        placeholder: "Paste content here..."
      }),
      React.createElement("button", {
        onClick: harvest,
        style: {
          marginTop: "10px",
          padding: "10px 20px",
          background: "#007bff",
          color: "white",
          border: "none",
          cursor: "pointer"
        }
      }, "Harvest Source")
    ),

    mode === "Dashboard" && React.createElement(
      "div",
      null,
      React.createElement("button", { onClick: () => setMode(null) }, "Back"),
      React.createElement(
        "table",
        {
          style: {
            width: "100%",
            marginTop: "20px",
            borderCollapse: "collapse"
          }
        },
        React.createElement(
          "tbody",
          null,
          blocks.map((b, i) =>
            React.createElement(
              "tr",
              {
                key: i,
                style: {
                  borderBottom: "1px solid #ddd"
                }
              },
              React.createElement("td", { style: { padding: "8px" } }, b.sourceNumber),
              React.createElement("td", { style: { padding: "8px" } }, b.detectedType),
              React.createElement(
                "td",
                {
                  style: {
                    padding: "8px",
                    color: b.status === "READY_TO_MIRROR" ? "green" : "orange"
                  }
                },
                b.status
              ),
              React.createElement(
                "td",
                null,
                React.createElement("button", {
                  onClick: () => {
                    setIndex(i);
                    setMode("Review");
                  }
                }, "Review")
              )
            )
          )
        )
      )
    ),

    mode === "Review" && active && React.createElement(
      "div",
      null,
      React.createElement("button", { onClick: () => setMode("Dashboard") }, "Dashboard"),
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            gap: "20px",
            marginTop: "20px"
          }
        },
        React.createElement(
          "pre",
          {
            style: {
              flex: 1,
              background: "#f8f9fa",
              padding: "15px",
              whiteSpace: "pre-wrap"
            }
          },
          active.rawText
        ),
        React.createElement(
          "pre",
          {
            style: {
              flex: 1,
              background: "#eef",
              padding: "15px",
              whiteSpace: "pre-wrap"
            }
          },
          JSON.stringify(active.mirrorPayload, null, 2)
        )
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
