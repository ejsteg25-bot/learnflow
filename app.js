const { useState } = React;

function App() {
  const [text, setText] = useState("");
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [issues, setIssues] = useState([]);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [mode, setMode] = useState(null);
  const [reteachInput, setReteachInput] = useState("");
  const [reteachMessage, setReteachMessage] = useState("");

  const REQUIRED_LABELS = ["A", "B", "C", "D"];

  // ===============================
  // FILE UPLOAD
  // ===============================
  async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    resetSession();

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setIssues(["Only .docx files are supported."]);
      return;
    }

    if (typeof mammoth === "undefined") {
      setIssues(["Mammoth not loaded."]);
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });

      if (!result.value || !result.value.trim()) {
        setIssues(["No usable text found."]);
        return;
      }

      setText(result.value);
      setIssues(["DOCX loaded. Click Analyze."]);
    } catch {
      setIssues(["Error reading DOCX file."]);
    }
  }

  function resetSession() {
    setQuestions([]);
    setIndex(0);
    setIssues([]);
    setSelectedAnswers({});
    setMode(null);
    setReteachInput("");
    setReteachMessage("");
  }

  // ===============================
  // HELPERS
  // ===============================
  function cleanText(v) {
    return v
      .replace(/\r/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, " ")
      .replace(/→/g, "->")
      .trim();
  }

  function normalizeLine(l) {
    return l.replace(/\s+/g, " ").trim();
  }

  function verticalizeChoices(value) {
    return value
      .replace(/\s+([B-Da-d])[\.\)]\s+/g, "\n$1. ")
      .replace(/\s+([A-Da-d])[\.\)]{2,}\s*/g, "\n$1. ");
  }

  function isNoiseLine(l) {
    const c = l.toLowerCase();
    return (
      c === "" ||
      c === "matching" ||
      c.includes("column a") ||
      c.includes("column b") ||
      c.includes("name:") ||
      c.includes("date:") ||
      c.includes("page")
    );
  }

  function isQuestionStart(line) {
    return /^\s*(?:question\s*)?\d+[.)]\s*/i.test(line);
  }

  function getQuestionStart(line) {
    const match = line.match(/^\s*(?:question\s*)?(\d+)[.)]\s*(.*)$/i);
    return match
      ? { sourceNumber: match[1], promptStart: match[2].trim() }
      : null;
  }

  function parseChoiceLine(line) {
    const match = line.match(/^\s*([A-Da-d])[\.\)]\s*(.*)$/);
    if (!match) return null;

    let text = match[2].trim();
    const isCorrect = /\*{2,3}/.test(text);

    text = text.replace(/\*{2,3}/g, "").trim();

    return {
      label: match[1].toUpperCase(),
      text,
      isCorrect
    };
  }

  function parseAnswerLine(line) {
    const match = line.match(/^answer\s*:\s*([A-D])/i);
    return match ? match[1].toUpperCase() : null;
  }

  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  // ===============================
  // PARSER (PHASE 1 + ANSWER KEY)
  // ===============================
  function parse() {
    setMode(null);
    setSelectedAnswers({});
    setIndex(0);

    const foundIssues = [];

    function extractAnswerKeyAndCleanText(value) {
      const lines = value.split("\n");
      const keptLines = [];
      const answerKey = {};
      let inKey = false;

      lines.forEach(line => {
        const clean = normalizeLine(line);
        const lower = clean.toLowerCase();

        if (
          lower === "answer key" ||
          lower === "answers" ||
          lower.startsWith("answer key:")
        ) {
          inKey = true;
          return;
        }

        if (inKey) {
          if (isQuestionStart(clean) && clean.length > 10) {
            inKey = false;
            keptLines.push(line);
            return;
          }

          const match = clean.match(/^(\d+)[.)]?\s*[-:]?\s*([A-D])/i);
          if (match) {
            answerKey[match[1]] = match[2].toUpperCase();
          }
          return;
        }

        keptLines.push(line);
      });

      return {
        cleanedText: keptLines.join("\n"),
        answerKey
      };
    }

    const extracted = extractAnswerKeyAndCleanText(cleanText(text));
    const raw = extracted.cleanedText;
    const externalKey = extracted.answerKey;

    const lines = verticalizeChoices(raw)
      .split("\n")
      .map(normalizeLine)
      .filter(l => l && !isNoiseLine(l));

    const blocks = [];
    let current = null;

    lines.forEach(line => {
      if (isQuestionStart(line)) {
        if (current) blocks.push(current);
        current = { lines: [line] };
      } else if (current) {
        current.lines.push(line);
      }
    });
    if (current) blocks.push(current);

    const parsed = blocks.map(block => {
      const qData = getQuestionStart(block.lines[0]);
      if (!qData) return null;

      let promptLines = [qData.promptStart];
      let choices = {};
      let answer = null;
      let unlabeled = [];

      block.lines.slice(1).forEach(line => {
        const c = parseChoiceLine(line);

        if (c) {
          choices[c.label] = c.text;
          if (c.isCorrect) answer = c.label;
        } else if (/^answer/i.test(line)) {
          const key = parseAnswerLine(line);
          if (key) answer = key;
        } else {
          promptLines.push(line);
          unlabeled.push(line);
        }
      });

      // fallback unlabeled
      if (Object.keys(choices).length === 0 && unlabeled.length >= 4) {
        const last4 = unlabeled.slice(-4);

        REQUIRED_LABELS.forEach((l, i) => {
          let t = last4[i];
          if (/\*{2,3}/.test(t)) {
            answer = l;
            t = t.replace(/\*{2,3}/g, "").trim();
          }
          choices[l] = t;
        });

        promptLines = promptLines.slice(0, -4);
      }

      return {
        sourceNumber: qData.sourceNumber,
        prompt: promptLines.join(" ").trim(),
        choices,
        answer: answer || externalKey[qData.sourceNumber] || null
      };
    }).filter(Boolean);

    const valid = parsed.filter(q =>
      q.prompt.length > 5 &&
      REQUIRED_LABELS.every(l => q.choices[l])
    );

    setQuestions(valid);
    setIssues([`Parsed ${valid.length} questions.`]);
  }

  // ===============================
  // NAVIGATION
  // ===============================
  function startMode(m) {
    setMode(m);
    setIndex(0);
    setSelectedAnswers({});
    if (m === "Quiz" || m === "Tutor") {
      setQuestions(prev => shuffleArray(prev));
    }
  }

  function backToModes() {
    setMode(null);
    setIndex(0);
  }

  function nextQuestion() {
    setIndex(i => Math.min(i + 1, questions.length - 1));
  }

  function previousQuestion() {
    setIndex(i => Math.max(i - 1, 0));
  }

  function startReteach() {
    const idx = questions.findIndex(q => q.sourceNumber === reteachInput);
    if (idx === -1) {
      setReteachMessage("Not found");
      return;
    }
    setIndex(idx);
  }

  function setAnswerKey(label) {
    const updated = [...questions];
    updated[index].answer = label;
    setQuestions(updated);
  }

  const currentQuestion = questions[index];

  // ===============================
  // UI
  // ===============================
  return React.createElement("div", { className: "p-6 max-w-4xl mx-auto" },

    React.createElement("h1", null, "LearnFlow"),

    questions.length === 0 &&
      React.createElement("div", null,
        React.createElement("input", { type: "file", onChange: handleFileUpload }),
        React.createElement("textarea", { value: text, onChange: e => setText(e.target.value) }),
        React.createElement("button", { onClick: parse }, "Analyze")
      ),

    questions.length > 0 && !mode &&
      React.createElement("div", null,
        questions.map((q, i) =>
          React.createElement("div", { key: i },
            q.sourceNumber, " - ", q.answer || "MISSING",
            React.createElement("button", { onClick: () => { setIndex(i); setMode("Editor"); } }, "Edit")
          )
        ),
        React.createElement("button", { onClick: () => startMode("Quiz") }, "Quiz")
      ),

    mode === "Editor" &&
      React.createElement("div", null,
        currentQuestion.prompt,
        REQUIRED_LABELS.map(l =>
          React.createElement("button", {
            key: l,
            onClick: () => setAnswerKey(l)
          }, l + ". " + currentQuestion.choices[l])
        ),
        React.createElement("button", { onClick: backToModes }, "Back")
      )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
