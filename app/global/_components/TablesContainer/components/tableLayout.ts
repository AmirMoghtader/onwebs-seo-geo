// Column configurations
export const initialColumnWidths = [
  "40px", // ID
  "500px", // URL
  "400px", // Page Title
  "70px", // Page title length
  "300px", // Page Description
  "80px", // Page Description Length
  "350px", // H1
  "70px", // H1 Length
  "350px", // H2
  "60px", // H2 Length
  "100px", // Status Code
  "100px", // TEXT RATIO
  "100px", // Flesch score
  "120px", // Flesch grade
  "100px", // Word Count
  "60px", //  Mobile
  "90px", // Meta Robots
  "120px", // CONTENT TYPE
  "100px", //  Indexability
  "70px", //  Language
  "70px", //  Schema
  "70px", //  Depth
  "70px", //  OpenGraph
  "70px", //  Cookies
  "70px", //  Page Size
  "90px", //  Link Score
];

export const initialColumnAlignments = [
  "center", // ID
  "left", // URL
  "left", // Page Title
  "center", // Page Title Length
  "left", // Page Description
  "center", // Page Description Length
  "left", // H1
  "center", // H1 Length
  "left", // H2
  "center", // H2 Length
  "center", // Status Code
  "center", // Word Count
  "center", // Text Ratio
  "center", // Text Ratio
  "center", // Text Ratio
  "center", // Mobile Friendly
  "left", // META ROBOTS
  "left", //  CONTENT TYPE
  "left", //  Indexability
  "center", //  Language
  "center", //  Schema
  "center", //  Depth
  "center", //  OpenGraph
  "center", //  Cookies
  "center", //  Page Size
  "center", //  Link Score
];

/**
 * The value shown in each column, in header order.
 *
 * This used to live inside TableRow's useMemo, which meant the parent — the
 * component that actually owns the row array — had no way to ask "what does
 * column 3 show for this row?" and so could not sort. It is a pure function
 * now so TableRow and the sort comparator read from exactly one definition and
 * can never drift apart.
 */
export function getRowValues(row: any, index: number): any[] {
  return [
    index + 1, // ID
    row?.url || "", // URL
    row?.title?.[0]?.title || "", // Page Title
    row?.title?.[0]?.title_len || "", // Title Size
    row?.description || "", // Description
    row?.description?.length || "", // Desc. Size
    row?.headings?.h1?.[0] || "", // H1
    row?.headings?.h1?.[0]?.length || "", // H1 Size
    row?.headings?.h2?.[0] || "", // H2
    row?.headings?.h2?.[0]?.length || "", // H2 Size
    row?.status_code || "", // Status Code
    row?.word_count || "", // Word Count
    !isNaN(Number(row?.text_ratio)) && row?.text_ratio !== null
      ? Number(row.text_ratio).toFixed(1)
      : !isNaN(Number(row?.text_ratio?.[0]?.text_ratio)) &&
          row?.text_ratio?.[0]?.text_ratio !== null
        ? Number(row.text_ratio[0].text_ratio).toFixed(1)
        : "", // Text Ratio
    !isNaN(Number(row?.flesch)) && row?.flesch !== null
      ? Number(row.flesch).toFixed(1)
      : !isNaN(Number(row?.flesch?.Ok?.[0])) && row?.flesch?.Ok?.[0] !== null
        ? Number(row.flesch.Ok[0]).toFixed(1)
        : "", // Flesch Score
    row?.flesch_grade || row?.flesch?.Ok?.[1] || "", // Flesch Grade
    row?.mobile ? "Yes" : "No", // Mobile
    row?.meta_robots?.meta_robots?.[0] || "", // Meta Robots
    row?.content_type || "", // Content Type
    row?.indexability?.indexability >= 0.5 ? "Indexable" : "Not Indexable", // Indexability
    row?.language || "", // Language
    row?.schema === true || row?.schema === "Yes" ? "Yes" : "No", // Schema
    row?.url_depth || "", // Depth
    row?.opengraph &&
    (typeof row.opengraph === "boolean"
      ? row.opengraph
      : Object.keys(row.opengraph).length > 0)
      ? "Yes"
      : "No", // OpenGraph
    typeof row?.cookies_count === "number"
      ? row.cookies_count
      : Array.isArray(row?.cookies?.Ok)
        ? row.cookies.Ok.length
        : Array.isArray(row?.cookies)
          ? row.cookies.length
          : 0, // Cookies
    row?.page_size?.[0]?.kb ? row.page_size[0].kb + " KB" : "", // Size
    row?.link_score ?? 0, // Link Score
  ];
}

export const headerTitles = [
  "ID",
  "URL",
  "Page Title",
  "Title Size",
  "Description",
  "Desc. Size",
  "H1",
  "H1 Size",
  "H2",
  "H2 Size",
  "Status Code",
  "Word Count",
  "Text Ratio",
  "Flesch Score",
  "Flesch Grade",
  "Mobile",
  "Meta Robots",
  "Content Type",
  "Indexability",
  "Language",
  "Schema",
  "Depth",
  "OpenGraph",
  "Cookies",
  "Size",
  "Link Score",
];
