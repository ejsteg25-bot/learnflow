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

  async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    resetSession();

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setIssues(["Only .docx files are supported right now."]);
      return;
    }

    if (typeof mammoth === "undefined") {
      setIssues([
        "DOCX reader is not loaded. Make sure mammoth.browser.min.js is included in index.html before app.js."
      ]);
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });

      if (!result.value || !result.value.trim()) {
        setText("");
        setIssues(["The DOCX file was read, but no usable text was found."]);
        return;
      }

      setText(result.value);
      setIssues(["DOCX uploaded successfully. Review the text, then click Analyze Material."]);
    } catch (error) {
      setIssues(["The DOCX file could not be read. Try saving it again as a clean .docx file."]);
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

  function cleanText(value) {
    return value
      .replace(/\r/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\u00a0/g, " ")
      .replace(/→/g, "->")
      .trim();
  }

  function normalizeLine(line) {
    return line.replace(/\s+/g, " ").trim();
  }

  function verticalizeChoices(value) {
    return value
      .replace(/\s+([B-Da-d])[\.\)]\s+/g, "\n$1. ")
      .replace(/\s+([A-Da-d])[\.\)]{2,}\s*/g, "\n$1. ");
  }

  function isNoiseLine(line) {
    const cleaned = line.toLowerCase().trim();

    return (
      cleaned === "" ||
      cleaned === "matching" ||
      cleaned === "multiple choice" ||
      cleaned.includes("match each description") ||
      cleaned.includes("column a") ||
      cleaned.includes("column b") ||
      cleaned.includes("do not write on this test") ||
      cleaned.includes("class set") ||
      cleaned.includes("name:") ||
      cleaned.includes("date:") ||
      cleaned.includes("period:") ||
      cleaned.includes("page ") ||
      cleaned.includes("more on back") ||
      cleaned.includes("directions:") ||
      cleaned.includes("multiple choice:") ||
      cleaned.includes("free response") ||
      cleaned.includes("scantron")
    );
  }

  function isQuestionStart(line) {
    return /^\s*(?:question\s*)?\d+[.)]\s*/i.test(line);
  }

  function getQuestionStart(line) {
    const match = line.match(/^\s*(?:question\s*)?(\d+)[.)]\s*(.*)$/i);
    if (!match) return null;

    return {
      sourceNumber: match[1],
      promptStart: match[2].trim()
    };
  }

  function isChoiceLine(line) {
    return /^\s*[A-Da-d][\.\)]\s*/.test(line);
  }

  function parseChoiceLine(line) {
    const match = line.match(/^\s*([A-Da-d])[\.\)]\s*(.*)$/);
    if (!match) return null;

    const label = match[1].toUpperCase();
    let text = match[2].trim();

    const isCorrect = /\*{2,3}/.test(text);
    text = text.replace(/\*{2,3}/g, "").trim();

    return {
      label,
      text,
      isCorrect
    };
  }

  function isAnswerLine(line) {
    return /^answer\s*:/i.test(line);
  }

  function parseAnswerLine(line) {
    const match = line.match(/^answer\s*:\s*([A-Da-d])/i);
    return match ? match[1].toUpperCase() : null;
  }

  function looksLikeMatchingLine(line) {
    return /\([A-F]\)$/.test(line) || /^[A-Za-z\s]+\([A-F]\)/.test(line);
  }

  function shuffleArray(array) {
    const copy = [...array];

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
  }

  function parse() {
    setMode(null);
    setSelectedAnswers({});
    setReteachInput("");
    setReteachMessage("");
    setIndex(0);

    const foundIssues = [];
    const rawCleaned = cleanText(text);
    const verticalized = verticalizeChoices(rawCleaned);

    if (!verticalized) {
      setQuestions([]);
      setIssues(["No text provided. Please upload a file or paste text."]);
      return;
    }

    const lines = verticalized
      .split("\n")
      .map(normalizeLine)
      .filter(line => line.length > 0)
      .filter(line => !isNoiseLine(line))
      .filter(line => !looksLikeMatchingLine(line));

    const blocks = [];
    let currentBlock = null;

    lines.forEach(line => {
      if (isQuestionStart(line)) {
        if (currentBlock) blocks.push(currentBlock);
        currentBlock = { lines: [line] };
      } else if (currentBlock) {
        currentBlock.lines.push(line);
      }
    });

    if (currentBlock) blocks.push(currentBlock);

    const parsedQuestions = blocks
      .map(block => {
        const firstLine = block.lines[0];
        const qData = getQuestionStart(firstLine);

        if (!qData) return null;

        let promptLines = [];
        let extractedChoices = {};
        let extractedAnswer = null;
        let potentialUnlabeledChoices = [];

        if (qData.promptStart) {
          promptLines.push(qData.promptStart);
        }

        block.lines.slice(1).forEach(line => {
          const choiceMatch = parseChoiceLine(line);

          if (choiceMatch) {
            extractedChoices[choiceMatch.label] = choiceMatch.text;
            if (choiceMatch.isCorrect) extractedAnswer = choiceMatch.label;
          } else if (isAnswerLine(line)) {
            const key = parseAnswerLine(line);
            if (key) extractedAnswer = key;
          } else {
            promptLines.push(line);
            potentialUnlabeledChoices.push(line);
          }
        });

        if (
          Object.keys(extractedChoices).length === 0 &&
          potentialUnlabeledChoices.length >= 4
        ) {
          const choiceSlice = potentialUnlabeledChoices.slice(-4);

          REQUIRED_LABELS.forEach((label, idx) => {
            let choiceText = choiceSlice[idx];

            if (/\*{2,3}/.test(choiceText)) {
              extractedAnswer = label;
              choiceText = choiceText.replace(/\*{2,3}/g, "").trim();
            }

            extractedChoices[label] = choiceText;
          });

          promptLines = promptLines.slice(0, promptLines.length - 4);
        }

        return {
          sourceNumber: qData.sourceNumber,
          prompt: promptLines.join(" ").trim(),
          choices: extractedChoices,
          answer: extractedAnswer
        };
      })
      .filter(Boolean);

    const seen = new Set();

    const validQuestions = parsedQuestions.filter(q => {
      if (seen.has(q.sourceNumber)) return false;
      seen.add(q.sourceNumber);

      const hasPrompt = q.prompt.length > 5;
      const hasAllChoices = REQUIRED_LABELS.every(label => q.choices[label]);

      if (!hasPrompt) {
        foundIssues.push(`Question ${q.sourceNumber}: Missing prompt text.`);
      }

      if (!hasAllChoices) {
        foundIssues.push(`Question ${q.sourceNumber}: Missing one or more choices (A-D).`);
      }

      if (hasPrompt && hasAllChoices && !q.answer) {
        foundIssues.push(`Question ${q.sourceNumber}: no correct answer detected (allowed in Quiz mode).`);
        q.answer = null;
      }

      return hasPrompt && hasAllChoices;
    });

    const safeQuestions = validQuestions.map(question => ({
      sourceNumber: question.sourceNumber,
      prompt: question.prompt,
      choices: {
        A: question.choices.A,
        B: question.choices.B,
        C: question.choices.C,
        D: question.choices.D
      },
      answer: question.answer
    }));

    setQuestions(shuffleArray(safeQuestions));
    setIssues(
      foundIssues.length > 0
        ? foundIssues
        : ["Parsing successful. 4-choice blocks validated."]
    );
    setIndex(0);

    console.log("Phase One Result:", safeQuestions);
  }

  function startMode(selectedMode) {
    setMode(selectedMode);
    setIndex(0);
    setSelectedAnswers({});
    setReteachInput("");
    setReteachMessage("");
  }

  function startReteach() {
    const requested = reteachInput.trim();

    if (!requested) {
      setReteachMessage("Enter a source question number first.");
      return;
    }

    const foundIndex = questions.findIndex(q => q.sourceNumber === requested);

    if (foundIndex === -1) {
      setReteachMessage(`Question ${requested} was not found or was skipped during validation.`);
      return;
    }

    setIndex(foundIndex);
    setReteachMessage("");
  }

  function selectAnswer(label) {
    const currentQuestion = questions[index];

    if (!currentQuestion) return;

    setSelectedAnswers(prev => ({
      ...prev,
      [currentQuestion.sourceNumber]: label
    }));
  }

  function nextQuestion() {
    setIndex(i => Math.min(i + 1, questions.length - 1));
  }

  function previousQuestion() {
    setIndex(i => Math.max(i - 1, 0));
  }

  function backToModes() {
    setMode(null);
    setSelectedAnswers({});
    setReteachInput("");
    setReteachMessage("");
    setIndex(0);
  }

  const currentQuestion = questions[index];

  return React.createElement(
    "div",
    { className: "p-6 max-w-4xl mx-auto font-sans" },

    React.createElement("h1", { className: "text-3xl font-bold mb-2" }, "LearnFlow"),

    React.createElement(
      "p",
      { className: "mb-4 text-gray-700" },
      "Upload a DOCX file or paste text below. Phase One checks whether the material can be parsed into clean multiple-choice questions."
    ),

    React.createElement("input", {
      type: "file",
      accept: ".docx",
      className: "mb-4 block border rounded p-2",
      onChange: handleFileUpload
    }),

    React.createElement("textarea", {
      className: "w-full border rounded p-3 mb-4",
      rows: 12,
      value: text,
      onChange: e => setText(e.target.value),
      placeholder: "1. Question text\nA. choice\nB. choice\nC. choice\nD. correct choice***"
    }),

    React.createElement(
      "button",
      {
        className: "bg-blue-600 text-white px-4 py-2 rounded",
        onClick: parse
      },
      "Analyze Material"
    ),

    issues.length > 0 &&
      React.createElement(
        "div",
        { className: "mt-4 border border-yellow-400 bg-yellow-50 p-3 rounded" },
        React.createElement("h2", { className: "font-bold mb-2" }, "Phase One Parse Report"),
        React.createElement(
          "ul",
          { className: "list-disc ml-6" },
          issues.map((issue, i) => React.createElement("li", { key: i }, issue))
        )
      ),

    questions.length > 0 &&
      !mode &&
      React.createElement(
        "div",
        { className: "mt-6 border rounded p-5 bg-white shadow" },

        React.createElement("h2", { className: "text-xl font-bold mb-2" }, "Choose a Mode"),

        React.createElement(
          "p",
          { className: "text-gray-600 mb-4" },
          `${questions.length} valid multiple-choice question(s) are ready.`
        ),

        React.createElement(
          "div",
          { className: "grid md:grid-cols-3 gap-3" },

          React.createElement(
            "button",
            {
              className: "border rounded p-4 text-left hover:bg-blue-50",
              onClick: () => startMode("Quiz")
            },
            React.createElement("div", { className: "font-bold text-blue-700" }, "Quiz Mode"),
            React.createElement("div", { className: "text-sm text-gray-600" }, "Independent practice.")
          ),

          React.createElement(
            "button",
            {
              className: "border rounded p-4 text-left hover:bg-green-50",
              onClick: () => startMode("Tutor")
            },
            React.createElement("div", { className: "font-bold text-green-700" }, "Tutor Mode"),
            React.createElement("div", { className: "text-sm text-gray-600" }, "Guided support mode.")
          ),

          React.createElement(
            "button",
            {
              className: "border rounded p-4 text-left hover:bg-purple-50",
              onClick: () => startMode("Reteach")
            },
            React.createElement("div", { className: "font-bold text-purple-700" }, "Reteach Mode"),
            React.createElement("div", { className: "text-sm text-gray-600" }, "Load exact source question.")
          )
        )
      ),

    questions.length > 0 &&
      mode === "Reteach" &&
      React.createElement(
        "div",
        { className: "mt-6 border rounded p-4 bg-purple-50" },

        React.createElement("h2", { className: "font-bold mb-2" }, "Reteach Lookup"),

        React.createElement(
          "div",
          { className: "flex gap-2 mb-2" },
          React.createElement("input", {
            className: "border rounded p-2 flex-1",
            value: reteachInput,
            onChange: e => setReteachInput(e.target.value),
            placeholder: "Enter source question number, example: 14"
          }),
          React.createElement(
            "button",
            {
              className: "bg-purple-600 text-white px-4 py-2 rounded",
              onClick: startReteach
            },
            "Load"
          )
        ),

        reteachMessage &&
          React.createElement("p", { className: "text-sm text-red-700" }, reteachMessage)
      ),

    questions.length > 0 &&
      mode &&
      currentQuestion &&
      React.createElement(
        "div",
        { className: "mt-6 border rounded p-4 bg-white shadow" },

        React.createElement(
          "div",
          { className: "mb-3 flex justify-between items-center text-sm text-gray-600" },
          React.createElement(
            "span",
            null,
            mode === "Reteach"
              ? `Reteach: Source Question ${currentQuestion.sourceNumber}`
              : `${mode} Mode — Question ${index + 1} of ${questions.length}`
          ),
          React.createElement(
            "button",
            {
              className: "text-blue-600 underline",
              onClick: backToModes
            },
            "Change Mode"
          )
        ),

        React.createElement(
          "p",
          { className: "text-lg font-semibold mb-4" },
          currentQuestion.prompt
        ),

        React.createElement(
          "div",
          { className: "space-y-2" },
          REQUIRED_LABELS.map(label => {
            const isSelected =
              selectedAnswers[currentQuestion.sourceNumber] === label;

            return React.createElement(
              "button",
              {
                key: label,
                className: isSelected
                  ? "w-full text-left border rounded p-2 bg-blue-100 border-blue-500"
                  : "w-full text-left border rounded p-2 bg-white hover:bg-gray-100",
                onClick: () => selectAnswer(label)
              },
              `${label}. ${currentQuestion.choices[label]}`
            );
          })
        ),

        mode !== "Reteach" &&
          React.createElement(
            "div",
            { className: "mt-4 flex gap-2" },

            React.createElement(
              "button",
              {
                className: "bg-gray-600 text-white px-4 py-2 rounded disabled:opacity-50",
                onClick: previousQuestion,
                disabled: index === 0
              },
              "Previous"
            ),

            React.createElement(
              "button",
              {
                className: "bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50",
                onClick: nextQuestion,
                disabled: index === questions.length - 1
              },
              "Next"
            )
          )
      )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
