const { useState } = React;

function App() {
  const [text, setText] = useState("");
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);

  function parse() {
    const lines = text.split("\n").filter(l => l.trim());
    const qs = [];

    for (let line of lines) {
      if (/^\d+\./.test(line)) {
        qs.push({ prompt: line });
      }
    }

    setQuestions(qs);
    setIndex(0);
  }

  return (
    React.createElement("div", { className: "p-6" },
      React.createElement("h1", { className: "text-3xl font-bold mb-4" }, "LearnFlow"),

      React.createElement("textarea", {
        className: "w-full border p-3 mb-4",
        rows: 6,
        value: text,
        onChange: e => setText(e.target.value)
      }),

      React.createElement("button", {
        className: "bg-blue-600 text-white px-4 py-2",
        onClick: parse
      }, "Analyze Material"),

      questions.length > 0 &&
      React.createElement("div", { className: "mt-6" },
        React.createElement("h2", {}, `Question ${index + 1}`),
        React.createElement("p", {}, questions[index].prompt),

        React.createElement("button", {
          className: "mt-4 bg-green-600 text-white px-4 py-2",
          onClick: () => setIndex(i => Math.min(i + 1, questions.length - 1))
        }, "Next")
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(App)
);
