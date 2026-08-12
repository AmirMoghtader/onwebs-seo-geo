use once_cell::sync::Lazy;
use scraper::{Html, Selector};

static CONTENT_SELECTOR: Lazy<Selector> = Lazy::new(|| Selector::parse("p, h1, h2, h3, h4, h5, h6, li, blockquote").unwrap());

pub fn get_word_count(document: &Html) -> usize {
    let mut word_count = 0;

    for element in document.select(&CONTENT_SELECTOR) {
        let text = element.text(); // Get an iterator over the text segments

        for word in text.collect::<String>().split_whitespace() {
            // More precise word counting (e.g., handle hyphens, contractions)
            let cleaned_word = word.trim_matches(|c: char| !c.is_alphanumeric());
            if !cleaned_word.is_empty() {
                word_count += 1;
            }
        }
    }

    word_count
}


/// Sentences in the same content elements the word count uses.
///
/// Screaming Frog reports this alongside Word Count and derives Average Words
/// Per Sentence from the pair. Counting has to happen here, next to the word
/// count, because the page text is not kept after parsing — computing it in
/// the frontend would mean shipping the whole body to the UI.
///
/// Terminators cover Latin (.!?), Persian/Arabic (؟ ۔) and the ellipsis, and
/// runs of them collapse so "Really?!" is one sentence, not two.
pub fn get_sentence_count(document: &Html) -> usize {
    const TERMINATORS: [char; 6] = ['.', '!', '?', '؟', '۔', '…'];

    let mut sentences = 0usize;
    let mut has_text_since_terminator = false;

    for element in document.select(&CONTENT_SELECTOR) {
        let text = element.text().collect::<String>();
        let mut prev_was_terminator = false;

        for ch in text.chars() {
            if TERMINATORS.contains(&ch) {
                if has_text_since_terminator && !prev_was_terminator {
                    sentences += 1;
                    has_text_since_terminator = false;
                }
                prev_was_terminator = true;
            } else {
                prev_was_terminator = false;
                if ch.is_alphanumeric() {
                    has_text_since_terminator = true;
                }
            }
        }

        // A block that ends without punctuation — a heading or list item —
        // still reads as one sentence.
        if has_text_since_terminator {
            sentences += 1;
            has_text_since_terminator = false;
        }
    }

    sentences
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(html: &str) -> Html {
        Html::parse_document(html)
    }

    #[test]
    fn counts_plain_sentences() {
        assert_eq!(get_sentence_count(&doc("<p>One. Two. Three.</p>")), 3);
    }

    #[test]
    fn a_heading_without_punctuation_is_one_sentence() {
        assert_eq!(get_sentence_count(&doc("<h1>A title with no full stop</h1>")), 1);
    }

    #[test]
    fn runs_of_terminators_count_once() {
        assert_eq!(get_sentence_count(&doc("<p>Really?! Yes...</p>")), 2);
    }

    #[test]
    fn handles_persian_terminators() {
        assert_eq!(get_sentence_count(&doc("<p>سلام؟ خوبی؟</p>")), 2);
    }

    #[test]
    fn empty_content_is_zero_not_one() {
        assert_eq!(get_sentence_count(&doc("<p>   </p>")), 0);
    }
}
