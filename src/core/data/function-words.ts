/**
 * Closed-class words: articles, pronouns, prepositions, conjunctions, auxiliaries
 * and the handful of adverbs and quantifiers that go with them.
 *
 * These are familiar by construction — nobody reading English does not know
 * "the" — but a *knowledge* survey scores them erratically, because "do you know
 * this word?" is a strange question about a function word. In this data set `is`
 * scores 1.93, `a` 2.05, `to` 2.09 while `cat` and `water` sit at the 2.58
 * ceiling, so any prevalence threshold above about 1.9 would otherwise flag
 * grammar instead of vocabulary: at 2.0 the first word the tool flagged in
 * ordinary prose was "is", and at 2.2 the list was `is`, `when`, `not`, `a`,
 * `so`.
 *
 * Keeping them out of the arithmetic makes the threshold mean what it says —
 * "how well known must a vocabulary word be" — at every setting.
 *
 * `isFamiliarWord` consults this before the prevalence list, so a variant of a
 * function word ("itself", "theirs") is covered by the list check when it is
 * stored and by the inflection rules when it is not.
 */
const RAW = `
a about above across after again against all almost along already also although always am among an and
another any anybody anyone anything are around as at back be because been before behind being below
beneath beside besides between beyond both but by can cannot could did do does doing done down during
each either else enough even ever every everybody everyone everything except far few for from further
had has have having he her here hers herself him himself his how however i if in inside into is it its
itself just least less let like little many may me might mine more most much must my myself near
neither never no nobody none nor not nothing now of off on once one only onto or other others otherwise
our ours ourselves out outside over own past per perhaps rather really same shall she should since so
some somebody someone something sometimes still such than that the their theirs them themselves then
there these they this those though through thus to too toward towards under until up upon us very via
was we well were what whatever when whenever where whereas whether which while who whoever whom whose
why will with within without would yes yet you your yours yourself yourselves
`;

export const FUNCTION_WORDS: ReadonlySet<string> = new Set(RAW.split(/\s+/).filter(Boolean));
