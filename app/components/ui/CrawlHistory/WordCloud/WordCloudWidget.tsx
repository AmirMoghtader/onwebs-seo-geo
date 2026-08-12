import React from "react";
import WordCloud from "react-wordcloud";

const words = [
  { text: "React", value: 50 },
  { text: "JavaScript", value: 30 },
];

const WordCloudWidget = () => {
  try {
    return (
      <div style={{ height: 400, width: "100%" }}>
        <WordCloud words={words} />
      </div>
    );
  } catch (error) {
    console.error("WordCloud error:", error);
    return <div>در حال حاضر نمایش ابر کلمات ممکن نیست.</div>;
  }
};

export default WordCloudWidget;
