// @ts-nocheck
import React, { useEffect, useRef } from "react";
import useGlobalCrawlStore from "@/store/GlobalCrawlDataStore";

const DetailsTable = ({ data, height }) => {
  const tableBodyRef = useRef(null);
    const favicon = useGlobalCrawlStore((state) => state.favicon);

  useEffect(() => {
    const handleScroll = () => {
      const tableBody = tableBodyRef.current;
      if (tableBody) {
        const header = document.querySelector(".table-header");
        const headerColumns = header.querySelectorAll("th");
        const bodyColumns = tableBody.querySelectorAll("tr:first-child td");

        bodyColumns.forEach((bodyCol, index) => {
          const headerCol = headerColumns[index];
          headerCol.style.width = `${bodyCol.offsetWidth}px`;
        });
      }
    };

    const tableBody = tableBodyRef.current;
    if (tableBody) {
      tableBody.addEventListener("scroll", handleScroll);
    }

    return () => {
      if (tableBody) {
        tableBody.removeEventListener("scroll", handleScroll);
      }
    };
  }, []);

  if (data?.length === 0) {
    return (
      <div
        style={{
          height: `${height - 15}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <p className="dark:text-white/50 text-black/50 text-xs">
          برای دیدن جزئیات، یک URL از جدول HTML انتخاب کنید
        </p>
      </div>
    );
  }

  return (
    <div
      className="domainCrawlParent flex flex-col"
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <div
        className="table-header shrink-0"
        style={{
          zIndex: 10,
          backgroundColor: "#f87171",
        }}
      >
        <table
          className="detailsTable text-xs"
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  backgroundColor: "#f87171",
                  width: "260px",
                  padding: "4px 8px",
                  color: "#fff",
                }}
              >
                نام
              </th>
              <th
                style={{
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  backgroundColor: "#f87171",
                  padding: "4px 8px",
                  color: "#fff",
                }}
              >
                مقدار
              </th>
            </tr>
          </thead>
        </table>
      </div>
      <div
        className="flex-1"
        style={{
          overflow: "auto",
          width: "100%",
          padding: "0 0 3px 0",
        }}
        ref={tableBodyRef}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <tbody>
            {data?.map((anchorItem, index) => {
              return (
                <React.Fragment key={index}>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      URL
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.url}
                    </td>
                  </tr>
                  {favicon && (
                    <tr>
                      <td
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          border: "1px solid #ddd",
                          width: "260px",
                          fontWeight: 600,
                        }}
                      >
                        Favicon
                      </td>
                      <td
                        style={{
                          textAlign: "left",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          border: "1px solid #ddd",
                          padding: "4px 8px",
                        }}
                      >
                        {favicon ? favicon : ""}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      Canonical
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.canonicals || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      Title
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.title?.[0]?.title || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      طول Title
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.title?.[0]?.title?.length || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      Meta Description
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.description || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      طول Meta Description
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.description?.length || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      سرتیتر H1
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.headings?.h1 || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      طول سرتیتر H1
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.headings?.h1?.[0]?.length || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      Response Code
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.status_code || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      بهینه‌شده برای موبایل
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "4px",
                          backgroundColor: anchorItem?.mobile
                            ? "#10b981"
                            : "#ef4444",
                          color: "#fff",
                        }}
                      >
                        {anchorItem?.mobile ? "Yes" : "No"}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      قابل ایندکس
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.indexability?.indexability > 0.5
                        ? "Yes"
                        : "No"}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      Content Type
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.content_type || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      تعداد کلمات
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.word_count || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      نسبت متن
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {!isNaN(Number(anchorItem?.text_ratio?.[0]?.text_ratio)) && anchorItem?.text_ratio?.[0]?.text_ratio !== null
                        ? Number(anchorItem.text_ratio[0].text_ratio).toFixed(1)
                        : ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      ۱۰ کلمه کلیدی برتر
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.keywords?.slice(0, 10)?.map((item) => (
                        <span
                          className="border dark:border-brand-bright/80 my-1"
                          key={item[0]}
                          style={{
                            display: "inline-block",
                            marginRight: "6px",
                            marginLeft: "2px",
                            // border: "1px solid #ddd",
                            padding: "1px 8px",
                            borderRadius: "4px",
                          }}
                        >
                          {item[0]}{" "}
                          <span
                            className="bg-brand-bright"
                            style={{
                              color: "#fff",
                              borderRadius: "6px",
                              padding: "2px 8px",
                              fontSize: "10px",
                            }}
                          >
                            {item[1]}
                          </span>
                        </span>
                      )) || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      لینک‌های داخلی
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.anchor_links?.internal?.links?.length || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      لینک‌های خارجی
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.anchor_links?.external?.links?.length || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      تصاویر
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.images?.Ok
                        ? anchorItem?.images?.Ok?.length
                        : "N/A"}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      طول صفحه
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {typeof anchorItem?.page_size?.[0]?.length === "number"
                        ? anchorItem.page_size[0].length.toLocaleString() +
                          " bytes"
                        : "N/A"}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      حجم صفحه
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {typeof anchorItem?.page_size?.[0]?.kb === "number"
                        ? anchorItem.page_size[0].kb.toLocaleString() + " KB"
                        : "N/A"}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      زمان پاسخ
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.response_time
                        ? anchorItem?.response_time + " ms"
                        : "N/A"}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      عمق URL
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.url_depth ?? "N/A"}
                    </td>
                  </tr>
                  {anchorItem?.hreflangs?.map((lang) => (
                    <tr key={lang.id}>
                      <td
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          border: "1px solid #ddd",
                          padding: "2px 0",
                          width: "260px",
                          fontWeight: 600,
                        }}
                      >
                        {"Hreflang " + lang?.code?.toUpperCase()}
                      </td>
                      <td
                        style={{
                          textAlign: "left",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          border: "1px solid #ddd",
                          padding: "2px 0",
                        }}
                      >
                        {lang?.url}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      زبان
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {anchorItem?.language || ""}
                    </td>
                  </tr>
                  {Object.entries(anchorItem?.opengraph || {}).map(
                    ([key, value]) => (
                      <tr key={key}>
                        <td
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            border: "1px solid #ddd",
                            padding: "2px 0",
                            width: "260px",
                            fontWeight: 600,
                          }}
                        >
                          {"OG: " + key}
                        </td>
                        <td
                          style={{
                            textAlign: "left",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            border: "1px solid #ddd",
                            padding: "2px 0",
                          }}
                        >
                          {value}
                        </td>
                      </tr>
                    ),
                  )}
                  <tr>
                    <td
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                        width: "260px",
                        fontWeight: 600,
                      }}
                    >
                      Cookieها
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        border: "1px solid #ddd",
                        padding: "2px 0",
                      }}
                    >
                      {(anchorItem?.cookies?.Ok || anchorItem?.cookies || [])
                        .map((c) => c.toString().split("=")[0])
                        .map((name, i) => (
                          <span
                            key={i}
                            className="bg-gray-100 dark:bg-brand-dark border dark:border-white/10 dark:text-gray-300 px-2 py-0.5 rounded text-xs mr-2 inline-block my-0.5"
                          >
                            {name}
                          </span>
                        ))}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DetailsTable;
