#!/usr/bin/env python3
"""
Generate English wanted deck items TSV (db/ops/data/en-decks-wanted-20261028.tsv).
20 curated decks:
  1. cefr-a1-a2 (Foundation)
  2. cefr-b1 (Intermediate Threshold)
  3. cefr-b2 (Vantage)
  4. cefr-c1 (Effective Operational)
  5. cefr-c2 (Mastery)
  6. academic-word-list (AWL)
  7. toeic-450 (Foundation)
  8. toeic-650 (Intermediate)
  9. toeic-800 (Advanced)
  10. ielts-core-6 (Band 5.5 - 6.5)
  11. ielts-advanced-7 (Band 7.0 - 8.5)
  12. en-office-work (Office & Professional)
  13. en-hospital-health (Medical & Healthcare)
  14. en-restaurant-dining (Food & Hospitality)
  15. en-travel-hotel (Travel & Tourism)
  16. en-shopping-commerce (Retail & E-commerce)
  17. en-transport-traffic (Transit & Logistics)
  18. en-technology-digital (IT & Digital Life)
  19. en-finance-banking (Banking & Personal Finance)
  20. en-daily-conversation (Everyday Communication)
"""

import sys
import os

DECKS = {}

DECKS['cefr-a1-a2'] = [
    # Pronouns & Basics
    "i", "you", "he", "she", "it", "we", "they", "this", "that", "these", "those",
    "who", "what", "where", "when", "why", "how", "which", "whose", "here", "there",
    # Core Verbs
    "be", "have", "do", "say", "go", "get", "make", "know", "think", "take",
    "see", "come", "want", "look", "use", "find", "give", "tell", "work", "call",
    "try", "ask", "need", "feel", "become", "leave", "put", "mean", "keep", "let",
    "begin", "seem", "help", "talk", "turn", "start", "show", "hear", "play", "run",
    "move", "like", "live", "believe", "hold", "bring", "happen", "write", "provide", "sit",
    "stand", "lose", "pay", "meet", "include", "continue", "set", "learn", "change", "lead",
    "understand", "watch", "follow", "stop", "create", "speak", "read", "allow", "add", "spend",
    "grow", "open", "walk", "win", "offer", "remember", "love", "consider", "appear", "buy",
    "wait", "serve", "die", "send", "expect", "build", "stay", "fall", "cut", "reach",
    "kill", "remain", "suggest", "raise", "pass", "sell", "require", "report", "decide", "pull",
    # Essential Adjectives
    "good", "new", "first", "last", "long", "great", "little", "own", "other", "old",
    "right", "big", "high", "different", "small", "large", "next", "early", "young", "important",
    "few", "public", "bad", "same", "able", "easy", "hard", "clear", "recent", "late",
    "single", "medical", "current", "wrong", "private", "past", "foreign", "fine", "common", "poor",
    "natural", "significant", "similar", "hot", "cold", "happy", "sad", "fast", "slow", "simple",
    # Essential Nouns
    "time", "person", "year", "way", "day", "thing", "man", "world", "life", "hand",
    "part", "child", "eye", "woman", "place", "work", "week", "case", "point", "government",
    "company", "number", "group", "problem", "fact", "money", "water", "month", "book", "story",
    "mother", "father", "friend", "family", "house", "home", "car", "room", "school", "city",
    "country", "name", "job", "night", "morning", "evening", "afternoon", "door", "window", "street",
    "road", "town", "food", "table", "chair", "bed", "body", "head", "face", "hair",
    "question", "answer", "student", "teacher", "doctor", "phone", "music", "game", "picture", "paper",
    "language", "word", "letter", "animal", "dog", "cat", "fish", "bird", "tree", "flower",
    # Prepositions & Connectors
    "in", "on", "at", "to", "for", "with", "from", "by", "about", "into",
    "through", "during", "before", "after", "above", "below", "between", "under", "behind", "around",
    "and", "but", "or", "because", "so", "if", "although", "while", "since", "until",
    # Time & Quantity
    "today", "tomorrow", "yesterday", "now", "always", "never", "sometimes", "often", "usually", "soon",
    "already", "still", "again", "almost", "enough", "many", "much", "more", "most", "all"
]

DECKS['cefr-b1'] = [
    "ability", "abroad", "absence", "absolute", "academic", "accept", "access", "accident", "accompany", "accomplish",
    "according", "accurate", "accuse", "achieve", "achievement", "acknowledge", "acquire", "action", "active", "activity",
    "actual", "adapt", "addition", "additional", "address", "adequate", "adjust", "admire", "admit", "adopt",
    "adult", "advance", "advantage", "adventure", "advertise", "advice", "advise", "affair", "affect", "afford",
    "afraid", "agency", "agent", "aggressive", "agree", "agreement", "ahead", "aim", "alarm", "alcohol",
    "alive", "allow", "almost", "alone", "along", "already", "alternative", "although", "altogether", "amaze",
    "ambition", "ambitious", "amount", "amuse", "analyse", "analysis", "ancient", "anger", "angle", "angry",
    "anniversary", "announce", "announcement", "annoy", "annual", "anxious", "apologize", "apology", "apparent", "appeal",
    "appear", "appearance", "application", "apply", "appoint", "appointment", "appreciate", "approach", "appropriate", "approval",
    "approve", "approximate", "architect", "architecture", "argue", "argument", "arise", "armed", "army", "arrange",
    "arrangement", "arrest", "arrival", "arrive", "artificial", "artistic", "ashamed", "aside", "aspect", "assess",
    "assessment", "assignment", "assist", "assistance", "assistant", "associate", "association", "assume", "assumption", "assure",
    "athlete", "atmosphere", "attach", "attack", "attempt", "attend", "attention", "attitude", "attract", "attraction",
    "attractive", "audience", "author", "authority", "automatic", "available", "average", "avoid", "award", "aware",
    "awareness", "awkward", "background", "balance", "barely", "bargain", "barrier", "base", "basic", "basically",
    "basis", "battle", "bear", "beat", "beauty", "behave", "behavior", "belief", "belong", "benefit",
    "beside", "besides", "betray", "beyond", "billion", "bitter", "blame", "blank", "blind", "block",
    "boil", "bold", "bomb", "bond", "border", "bored", "boring", "borrow", "bother", "bottle",
    "bound", "brain", "branch", "brand", "brave", "breadth", "breathe", "breath", "bribe", "brief",
    "bright", "brilliant", "broad", "broadcast", "budget", "bullet", "bunch", "burden", "burn", "burst",
    "bury", "bush", "business", "calculate", "calm", "campaign", "cancel", "cancer", "candidate", "capable",
    "capacity", "capture", "career", "careful", "careless", "carpet", "carrot", "carry", "cash", "category",
    "cause", "cease", "ceiling", "celebrate", "celebration", "celebrity", "cell", "cemetery", "central", "ceremony",
    "certain", "certainly", "chain", "chairman", "challenge", "champion", "championship", "channel", "chaos", "chapter",
    "character", "characteristic", "charge", "charity", "charm", "charming", "chase", "cheap", "cheat", "check",
    "cheerful", "chemical", "chest", "chief", "childhood", "chimney", "choice", "choose", "church", "cigarette",
    "cinema", "circle", "circuit", "circumstance", "citizen", "civil", "claim", "classic", "classical", "classify"
]

DECKS['cefr-b2'] = [
    "abandon", "abolish", "absorb", "abstract", "absurd", "abundance", "abundant", "abuse", "accelerate", "accentuate",
    "accessible", "accommodate", "accommodation", "accumulate", "accuracy", "accustom", "acknowledge", "acquire", "acquisition", "activate",
    "acute", "adaptable", "adaptation", "addict", "addiction", "adequate", "adhere", "adjacent", "adjourn", "adjust",
    "administer", "administration", "admirable", "adolescent", "advent", "adverse", "adversity", "advocate", "aesthetic", "affection",
    "affiliate", "affirm", "affluent", "agenda", "aggravate", "aggregate", "aggressive", "agile", "agitation", "agonize",
    "ailment", "alienate", "align", "allege", "allegiance", "allocate", "allocation", "allude", "allure", "ally",
    "alter", "alteration", "alternate", "altitude", "ambiguity", "ambiguous", "amenity", "amiable", "ample", "amplify",
    "analogous", "analogy", "analytical", "anchor", "anecdote", "animate", "animosity", "annex", "anomaly", "anonymous",
    "antagonist", "anticipate", "anticipation", "apathy", "apex", "apparatus", "appeal", "appease", "applaud", "applicable",
    "applicant", "appoint", "appraise", "appreciable", "apprehend", "apprehensive", "approach", "appropriate", "aptitude", "arbitrary",
    "arcade", "archaic", "ardent", "arduous", "arena", "arguably", "aristocrat", "arouse", "articulate", "artisan",
    "ascertain", "ascribe", "aspire", "aspiration", "assail", "assassinate", "assault", "assemble", "assembly", "assert",
    "assertion", "assess", "assessment", "asset", "assiduous", "assimilate", "associate", "assumption", "assurance", "astonish",
    "astound", "astute", "asylum", "atrocity", "attain", "attainment", "attempt", "attend", "attribute", "audit",
    "augment", "auspicious", "austere", "austerity", "authentic", "authenticate", "authoritative", "authorize", "automation", "autonomous",
    "autonomy", "avalanche", "avert", "aviation", "avid", "avow", "baffle", "balance", "banish", "barren",
    "barricade", "beacon", "belittle", "belligerent", "benchmark", "benefactor", "benevolent", "benign", "beseech", "bestow",
    "bewilder", "bias", "biased", "bicker", "bilateral", "bizarre", "bland", "blatant", "bleak", "blemish",
    "bliss", "blissful", "bolster", "bombard", "bond", "boost", "botanical", "boundary", "bounty", "boycott",
    "brace", "bracket", "breach", "breakthrough", "breed", "brevity", "brink", "brisk", "brittle", "broaden",
    "buoyant", "burgeon", "burnish", "bustle", "buttress", "byproduct", "bystander", "cache", "calamity", "calibrate"
]

DECKS['cefr-c1'] = [
    "aberration", "abject", "abnegation", "abridge", "abstruse", "acclaim", "accolade", "acclimatize", "accord", "accost",
    "accretion", "acerbic", "acquisitive", "acrimony", "actuate", "acumen", "adage", "adamant", "adduce", "adept",
    "admonish", "adroit", "adulation", "adulterate", "advocacy", "aegis", "affable", "affectation", "affinity", "affliction",
    "aggrandize", "aghast", "alacrity", "alienation", "alimentary", "allay", "allegorical", "alleviate", "allocution", "aloof",
    "amalgamate", "ambience", "ambivalent", "ameliorate", "amenable", "amity", "amorphous", "anachronism", "analgesic", "anarchist",
    "anathema", "ancillary", "anecdotal", "animus", "annotate", "annul", "anomalous", "antediluvian", "antecedent", "anthropology",
    "antipathy", "antiquated", "antithesis", "antithetical", "apartheid", "apathetic", "aphorism", "apocryphal", "apolitical", "apologist",
    "apoplexy", "apostasy", "apotheosis", "appeasement", "appellation", "appendage", "apposite", "appraisal", "apprehension", "approbation",
    "appropriate", "apropos", "aquiline", "arable", "arbiter", "arbitrate", "arcane", "archetypal", "archetype", "archipelago",
    "ardor", "argot", "aria", "arrogate", "artful", "ascendant", "ascetic", "asceticism", "aseptic", "asinine",
    "asperity", "aspersion", "assailant", "assent", "asseverate", "assiduity", "assuage", "astringent", "astronomy", "astute",
    "atavism", "atheism", "atone", "atrocious", "attenuate", "attest", "attrition", "audacious", "audacity", "augment",
    "augury", "august", "auspices", "austere", "authoritarian", "autocratic", "automaton", "auxiliary", "avalanche", "avarice",
    "avaricious", "avenge", "aver", "aversion", "aviary", "avidity", "avocation", "avow", "avuncular", "awry",
    "axiom", "axiomatic", "badger", "badinage", "bailiwick", "bale", "baleful", "balk", "ballast", "balm"
]

DECKS['cefr-c2'] = [
    "aberrant", "abeyance", "abjure", "abscission", "abstemious", "abstinence", "abstruse", "acclivity", "accretion", "acerbic",
    "acme", "acolyte", "acquiesce", "acrid", "acrimonious", "actuarial", "actuate", "acumen", "adage", "adamantine",
    "addendum", "adduce", "adjuration", "admonitory", "adroit", "adulation", "adulterate", "umbrage", "adumbrate", "adventitious",
    "adversary", "aegis", "aesthetic", "affable", "affectation", "affidavit", "affiliation", "affinity", "affirmation", "affliction",
    "affluence", "affront", "agape", "agenda", "agglomeration", "aggrandize", "aggregate", "aggrieve", "aghast", "agility",
    "agitate", "agnostic", "agog", "agrarian", "alacrity", "alchemy", "alias", "alienate", "alimentary", "alimony",
    "allay", "allege", "allegiance", "allegory", "alleviate", "alliteration", "allocate", "allot", "allude", "allure",
    "allusion", "alluvial", "aloft", "aloof", "altercation", "altruism", "amalgamate", "amass", "ambidextrous", "ambience",
    "ambiguous", "ambivalence", "amble", "ambrosia", "ameliorate", "amenable", "amend", "amenity", "amiable", "amicable",
    "amiss", "amity", "amnesia", "amnesty", "amoral", "amorous", "amorphous", "amphibian", "amphitheater", "ample",
    "amplify", "amputate", "amuck", "amulet", "anachronism", "analgesic", "analogous", "analogy", "anarchist", "anarchy",
    "anathema", "ancillary", "anecdote", "anemia", "anesthetic", "animadversion", "animated", "animosity", "animus", "annals",
    "anneal", "annex", "annihilate", "annotate", "annuity", "annul", "anodyne", "anomalous", "anomaly", "anonymity"
]

DECKS['academic-word-list'] = [
    "abandon", "abstract", "academy", "access", "accommodate", "accompany", "accumulate", "accurate", "achieve", "acknowledge",
    "acquire", "adapt", "adequate", "adjacent", "adjust", "administrate", "adult", "advocate", "affect", "aggregate",
    "aid", "albeit", "allocate", "alter", "alternative", "ambiguous", "amend", "analogy", "analyse", "annual",
    "anticipate", "apparent", "append", "appreciate", "approach", "appropriate", "approximate", "arbitrary", "area", "aspect",
    "assemble", "assess", "assign", "assist", "assume", "assure", "attach", "attain", "attitude", "attribute",
    "author", "authority", "automate", "available", "aware", "behalf", "benefit", "bias", "bond", "brief",
    "bulk", "capable", "capacity", "category", "cease", "challenge", "channel", "chapter", "chart", "chemical",
    "circumstance", "cite", "civil", "clarify", "classic", "clause", "code", "coherent", "coincide", "collapse",
    "colleague", "commence", "comment", "commission", "commit", "commodity", "communicate", "community", "compatible", "compensate",
    "compile", "complement", "complex", "component", "compound", "comprehensive", "comprise", "compute", "conceive", "concentrate",
    "concept", "conclude", "concurrent", "conduct", "confer", "confine", "confirm", "conflict", "conform", "consent",
    "consequence", "considerable", "consist", "constant", "constitute", "constrain", "construct", "consult", "consume", "contact",
    "contemporary", "context", "contract", "contradict", "contrary", "contrast", "contribute", "controversy", "convene", "converse",
    "convert", "convince", "cooperate", "coordinate", "core", "corporate", "correspond", "create", "credit", "criteria",
    "crucial", "culture", "currency", "cycle", "data", "debate", "decade", "decline", "deduce", "define",
    "definite", "demonstrate", "denote", "deny", "depress", "derive", "design", "deviate", "device", "devote",
    "differentiate", "dimension", "diminish", "discrete", "discriminate", "displace", "display", "dispose", "distinct", "distort",
    "distribute", "diverse", "document", "domain", "domestic", "dominate", "draft", "drama", "duration", "dynamic",
    "economy", "edit", "element", "eliminate", "emerge", "emphasis", "empirical", "enable", "encounter", "energy",
    "enforce", "enhance", "enormous", "ensure", "entity", "environment", "equate", "equip", "equivalent", "erode",
    "error", "establish", "estate", "estimate", "ethic", "ethnic", "evaluate", "eventual", "evident", "evolve",
    "exceed", "exclude", "exhibit", "expand", "expert", "explicit", "exploit", "export", "expose", "external",
    "extract", "facilitate", "factor", "feature", "federal", "fee", "file", "final", "finance", "finite",
    "flexible", "fluctuate", "focus", "format", "formula", "forthcoming", "foundation", "framework", "function", "fund",
    "fundamental", "furthermore", "gender", "generate", "generation", "globe", "goal", "grade", "grant", "guarantee",
    "guideline", "hence", "hierarchy", "highlight", "hypothesis", "identical", "identify", "ideology", "ignorance", "illustrate"
]

DECKS['toeic-450'] = [
    "accept", "access", "accommodate", "account", "accurate", "acknowledge", "acquire", "action", "activity", "additional",
    "address", "adequate", "adjourn", "adjust", "advance", "advantage", "advertise", "advertisement", "advice", "advise",
    "afford", "agenda", "agreement", "allow", "alter", "alternative", "amount", "announce", "announcement", "annual",
    "anticipate", "apologize", "appeal", "applicant", "application", "apply", "appoint", "appointment", "appreciate", "approach",
    "appropriate", "approval", "approve", "approximate", "arrangement", "article", "assemble", "assistant", "associate", "assure",
    "attach", "attend", "attendance", "attract", "attractive", "authorize", "available", "average", "avoid", "award",
    "balance", "bank", "bargain", "benefit", "bill", "board", "book", "branch", "brand", "brief",
    "brochure", "budget", "buyer", "calculate", "campaign", "cancel", "cancellation", "candidate", "capable", "capacity",
    "career", "cashier", "caution", "certificate", "chair", "challenge", "charge", "check", "choose", "claim",
    "client", "clerk", "colleague", "collect", "combine", "commence", "commercial", "commission", "committee", "communicate",
    "company", "compare", "compensate", "compete", "competitor", "complain", "complaint", "complete", "comply", "component",
    "conclude", "condition", "conduct", "conference", "confirm", "confirmation", "conflict", "congratulate", "connect", "consider",
    "constant", "construct", "consult", "consultant", "consumer", "contact", "contain", "contract", "contribute", "convenient",
    "convey", "convince", "cooperate", "corporate", "corporation", "cost", "counsel", "coupon", "credit", "criteria",
    "crucial", "current", "customer", "customs", "damage", "data", "date", "deadline", "deal", "debate",
    "debt", "decide", "decision", "decrease", "deduct", "defect", "defective", "delay", "delegate", "delighted",
    "deliver", "delivery", "demand", "demonstrate", "department", "depend", "deposit", "description", "design", "designate",
    "destination", "detail", "detailed", "deter", "develop", "device", "differ", "difference", "direct", "director",
    "disagree", "discount", "discuss", "dispatch", "display", "dispute", "disrupt", "distribute", "distributor", "divide"
]

DECKS['toeic-650'] = [
    "abide", "abrupt", "absenteeism", "accelerate", "access", "accessible", "accommodate", "accomplish", "accordance", "accountability",
    "accountable", "accrue", "accumulate", "accuracy", "acquire", "acquisition", "actionable", "activate", "adaptability", "adherence",
    "adjudicate", "adjust", "administer", "admissible", "adopt", "advance", "adversary", "adverse", "affiliate", "affordable",
    "agenda", "agent", "aggregate", "aggressive", "agreement", "allocate", "allotment", "allowance", "alteration", "ambiguity",
    "amend", "amendment", "amortize", "amplify", "analyst", "annex", "anticipate", "apparel", "apparent", "appeal",
    "appraise", "appreciation", "apprehensive", "approach", "appropriate", "approval", "arbitration", "arrears", "articulate", "ascertain",
    "aspire", "assemble", "assembly", "assess", "assessment", "asset", "assign", "assignment", "assimilate", "associate",
    "assumption", "assurance", "attain", "attest", "attorney", "attribute", "audit", "auditor", "authenticate", "authoritative",
    "authorize", "automated", "autonomous", "availability", "bailout", "balance", "bankrupt", "bankruptcy", "bargain", "barrier",
    "benchmark", "beneficiary", "bequest", "bidder", "bilateral", "binding", "blanket", "boardroom", "boilerplate", "bolster",
    "bonus", "bookkeeping", "bottleneck", "bottom-line", "breach", "breakthrough", "briefing", "broker", "brokerage", "budgetary",
    "bureaucracy", "buyout", "by-law", "by-product", "calculate", "calibration", "campaign", "cancellation", "candidate", "capabilities",
    "capital", "capitalize", "carrier", "cartel", "cash-flow", "casualty", "catalyst", "catalog", "cautious", "cease",
    "censure", "centralize", "certificate", "certify", "cessation", "chairmanship", "chancellor", "chargeback", "charter", "circuitous",
    "circulate", "circumvent", "citation", "claimant", "clarification", "classify", "clause", "clearance", "clientele", "climate",
    "closure", "coalition", "coattail", "coerce", "coexistence", "cognizant", "collaborate", "collaboration", "collateral", "colleague",
    "collective", "commence", "commendable", "commerce", "commission", "commitment", "commodity", "commonwealth", "compatible", "compensate",
    "competence", "compile", "complacency", "compliance", "compliant", "complimentary", "component", "comprehensive", "compromise", "compulsion"
]

DECKS['toeic-800'] = [
    "aberrant", "abrogate", "abstemious", "abstention", "acquiesce", "acrimony", "actuarial", "adduce", "adjunct", "admonish",
    "adulterate", "adventitious", "aegis", "affidavit", "affinity", "affluent", "aggrandize", "alacrity", "alienate", "allegation",
    "alleviate", "allocable", "amalgamate", "ambiguity", "ambivalent", "ameliorate", "amenable", "amortization", "anachronism", "analogous",
    "ancillary", "annuity", "annulment", "anomaly", "antecedent", "antitrust", "apex", "apotheosis", "appease", "appellation",
    "apportion", "appraise", "approbation", "appropriate", "appurtenance", "arbitrage", "arbitrary", "archetype", "arduous", "arrears",
    "arrogate", "articulate", "ascendant", "ascertain", "aspersion", "assiduous", "assuage", "astute", "asymmetrical", "atavistic",
    "attenuate", "audit", "augment", "auspicious", "austere", "authoritarian", "autocratic", "autonomous", "avarice", "aver",
    "aversion", "bailment", "baleful", "banal", "barrage", "belligerent", "benefactor", "benevolent", "bequeath", "bespeak",
    "bifurcate", "bilateral", "boilerplate", "bolster", "bombastic", "bonanza", "bootless", "bourgeois", "breach", "brinkmanship",
    "buffer", "bullion", "buoyant", "bureaucracy", "burgeon", "buttress", "cabal", "cadence", "calamitous", "calculated",
    "callous", "camaraderie", "canon", "capitulate", "capricious", "captious", "carve-out", "cascade", "castigate", "catalyst",
    "categorical", "caveat", "celerity", "censorious", "certiorari", "cessation", "chicanery", "chimerical", "circuitous", "circumscribe",
    "circumspect", "circumvent", "cleave", "clemency", "clandestine", "coalesce", "codicil", "coercive", "cogent", "cognizance",
    "collateral", "collusion", "commensurate", "commodious", "compelling", "compendium", "complaisant", "complicity", "compromise", "compunction",
    "concatenate", "concede", "conciliatory", "concomitant", "concurrence", "condone", "conducive", "confer", "confidentiality", "conflagration"
]

DECKS['ielts-core-6'] = [
    "abundant", "accurate", "acquire", "adapt", "adequate", "adjacent", "adjust", "advantageous", "advocate", "affect",
    "aggregate", "alter", "alternative", "ambiguous", "analyze", "annual", "anticipate", "apparent", "appeal", "appreciate",
    "approach", "appropriate", "approximate", "arbitrary", "aspect", "assemble", "assert", "assess", "assign", "assist",
    "associate", "assume", "assure", "attain", "attitude", "attribute", "augment", "authority", "automate", "available",
    "benefit", "bias", "brief", "capable", "capacity", "category", "cease", "challenge", "channel", "characteristic",
    "clarify", "coherent", "coincide", "collapse", "colleague", "commence", "comment", "commission", "commit", "commodity",
    "compatible", "compensate", "compile", "complement", "complex", "component", "compound", "comprehensive", "comprise", "compute",
    "conceive", "concentrate", "concept", "conclude", "concurrent", "conduct", "confer", "confine", "confirm", "conflict",
    "conform", "consent", "consequence", "considerable", "consist", "consistent", "constant", "constitute", "constrain", "construct",
    "consult", "consume", "contact", "contemporary", "context", "contract", "contradict", "contrary", "contrast", "contribute",
    "controversy", "convene", "converse", "convert", "convince", "cooperate", "coordinate", "core", "corporate", "correspond",
    "crucial", "culture", "currency", "cycle", "data", "debate", "decade", "decline", "deduce", "define",
    "definite", "demonstrate", "denote", "deny", "depict", "depress", "derive", "design", "deteriorate", "deviate",
    "device", "devote", "differentiate", "dimension", "diminish", "discrete", "discriminate", "displace", "display", "dispose",
    "distinct", "distort", "distribute", "diverse", "document", "domain", "domestic", "dominate", "draft", "drama",
    "duration", "dynamic", "economy", "element", "eliminate", "emerge", "emphasis", "empirical", "enable", "encounter",
    "energy", "enforce", "enhance", "enormous", "ensure", "entity", "environment", "equate", "equip", "equivalent",
    "erode", "error", "establish", "estimate", "ethic", "ethnic", "evaluate", "eventual", "evident", "evolve"
]

DECKS['ielts-advanced-7'] = [
    "aberrant", "abhorrent", "abnegation", "abstruse", "acclimatize", "acerbic", "acumen", "admonish", "adroit", "adulation",
    "adversity", "aesthetic", "affable", "affectation", "affinity", "affluent", "alacrity", "alienate", "alleviate", "allocate",
    "allude", "altruistic", "amalgamate", "ambiguous", "ambivalent", "ameliorate", "amenable", "amorphous", "anachronism", "analogous",
    "anomalous", "antecedent", "antipathy", "antiquated", "antithesis", "apathetic", "apathy", "apocryphal", "appease", "apposite",
    "apprehensive", "approbation", "arbitrary", "arcane", "archetype", "arduous", "articulate", "ascetic", "ascribe", "assiduous",
    "assimilate", "assuage", "astute", "atavistic", "atrophy", "attenuate", "audacious", "augment", "auspicious", "austere",
    "authentic", "authoritarian", "autonomous", "avarice", "aversion", "banal", "beguile", "belligerent", "benefactor", "benevolent",
    "benign", "biased", "bland", "blatant", "bolster", "bombastic", "boorish", "breach", "brevity", "brittle",
    "buoyant", "burgeon", "cacophony", "cajole", "calamitous", "callous", "calumny", "camaraderie", "candor", "capitulate",
    "capricious", "captious", "castigate", "catalyst", "caustic", "censure", "cerebral", "chagrin", "champion", "charlatan",
    "chary", "chastise", "chicanery", "chimerical", "chronological", "circuitous", "circumlocution", "circumscribe", "circumspect", "circumvent",
    "clandestine", "coalesce", "coerce", "cogent", "cognizant", "coherent", "cohesive", "collaboration", "collusion", "commensurate",
    "commodious", "compelling", "compendious", "complacent", "complaisant", "complementary", "compliant", "complicity", "comprehensive", "compunction",
    "concede", "conciliatory", "concomitant", "condone", "conducive", "conflagration", "confluence", "conformity", "confound", "congenial"
]

DECKS['en-office-work'] = [
    "agenda", "colleague", "coworker", "deadline", "reschedule", "presentation", "conference", "minutes", "adjourn", "brainstorm",
    "manager", "supervisor", "director", "executive", "department", "headquarters", "branch", "workplace", "cubicle", "workstation",
    "employee", "employer", "staff", "intern", "trainee", "candidate", "applicant", "recruitment", "interview", "onboarding",
    "salary", "wage", "compensation", "bonus", "commission", "overtime", "pension", "allowance", "reimbursement", "payroll",
    "promotion", "demotion", "resignation", "retirement", "termination", "severance", "transfer", "appraisal", "evaluation", "probation",
    "contract", "agreement", "negotiate", "signature", "client", "stakeholder", "vendor", "supplier", "partnership", "collaboration",
    "project", "milestone", "deliverable", "objective", "strategy", "priority", "bottleneck", "workflow", "delegation", "task",
    "feedback", "performance", "productivity", "efficiency", "absenteeism", "workload", "burnout", "incentive", "morale", "achievement",
    "correspondence", "inquiry", "clarification", "memo", "notice", "announcement", "bulletin", "circular", "newsletter", "documentation",
    "compliance", "regulation", "guideline", "procedure", "policy", "code", "confidentiality", "integrity", "ethics", "transparency",
    "budget", "expense", "invoice", "receipt", "audit", "forecast", "revenue", "expenditure", "allocation", "statement",
    "schedule", "itinerary", "appointment", "calendar", "reminder", "postpone", "cancel", "confirm", "attendance", "absent",
    "organize", "coordinate", "facilitate", "implement", "execute", "oversee", "supervise", "monitor", "evaluate", "optimize",
    "communicate", "articulate", "clarify", "discuss", "resolve", "mediate", "liaise", "consult", "advise", "brief"
]

DECKS['en-hospital-health'] = [
    "hospital", "clinic", "ward", "emergency", "ambulance", "pharmacy", "laboratory", "surgery", "theatre", "radiology",
    "doctor", "physician", "surgeon", "pediatrician", "cardiologist", "dermatologist", "neurologist", "psychiatrist", "nurse", "paramedic",
    "patient", "visitor", "inpatient", "outpatient", "casualty", "victim", "donor", "recipient", "carrier", "practitioner",
    "symptom", "disease", "illness", "disorder", "infection", "fever", "cough", "fatigue", "nausea", "headache",
    "pain", "ache", "bruise", "fracture", "sprain", "wound", "bleeding", "swelling", "inflammation", "allergy",
    "diagnosis", "prognosis", "examination", "checkup", "screening", "biopsy", "ultrasound", "scan", "x-ray", "specimen",
    "treatment", "therapy", "rehabilitation", "cure", "remedy", "transplant", "operation", "procedure", "incision", "suture",
    "prescription", "medication", "medicine", "pill", "capsule", "tablet", "ointment", "syrup", "dosage", "injection",
    "antibiotic", "painkiller", "vaccine", "anesthetic", "sedative", "antiseptic", "insulin", "steroid", "supplement", "antidote",
    "bandage", "gauze", "plaster", "splint", "sling", "crutch", "wheelchair", "stretcher", "syringe", "thermometer",
    "blood", "pressure", "pulse", "heartbeat", "respiration", "circulation", "digestion", "immunity", "hormone", "metabolism",
    "chronic", "acute", "benign", "malignant", "contagious", "infectious", "terminal", "fatal", "hereditary", "congenital",
    "recover", "heal", "relieve", "alleviate", "soothe", "deteriorate", "worsen", "bleed", "faint", "suffocate",
    "hygiene", "sanitation", "sterilize", "disinfect", "quarantine", "isolation", "epidemic", "pandemic", "nutrition", "wellness"
]

DECKS['en-restaurant-dining'] = [
    "restaurant", "bistro", "cafe", "diner", "eatery", "buffet", "bakery", "kitchen", "pantry", "counter",
    "chef", "cook", "waiter", "waitress", "bartender", "host", "hostess", "sommelier", "barista", "dishwasher",
    "customer", "guest", "patron", "diner", "foodie", "party", "table", "booth", "terrace", "reservation",
    "menu", "special", "appetizer", "starter", "entree", "main", "dessert", "beverage", "cocktail", "wine",
    "order", "bill", "check", "receipt", "tip", "gratuity", "discount", "voucher", "takeaway", "delivery",
    "recipe", "ingredient", "flavor", "taste", "texture", "aroma", "spice", "seasoning", "sauce", "dressing",
    "delicious", "savory", "sweet", "sour", "bitter", "salty", "spicy", "bland", "crispy", "tender",
    "fresh", "stale", "raw", "cooked", "ripe", "rotten", "juicy", "greasy", "creamy", "smoky",
    "bake", "roast", "grill", "fry", "boil", "steam", "simmer", "stew", "sauté", "chop",
    "slice", "dice", "mince", "grate", "stir", "whisk", "blend", "season", "marinate", "garnish",
    "breakfast", "brunch", "lunch", "dinner", "supper", "snack", "feast", "banquet", "picnic", "refreshment",
    "vegetarian", "vegan", "gluten-free", "organic", "dairy", "seafood", "poultry", "beverage", "dessert", "portion",
    "serve", "consume", "devour", "sip", "gulp", "chew", "swallow", "digest", "crave", "recommend"
]

DECKS['en-travel-hotel'] = [
    "travel", "journey", "trip", "tour", "voyage", "cruise", "flight", "commute", "excursion", "expedition",
    "passport", "visa", "ticket", "boarding", "itinerary", "voucher", "brochure", "map", "guidebook", "insurance",
    "airport", "terminal", "gate", "runway", "departure", "arrival", "check-in", "customs", "immigration", "security",
    "luggage", "baggage", "suitcase", "backpack", "trolley", "carousel", "overweight", "fragile", "carry-on", "locker",
    "hotel", "hostel", "motel", "resort", "inn", "guesthouse", "suite", "lobby", "reception", "elevator",
    "reservation", "vacancy", "occupant", "amenity", "balcony", "view", "keycard", "concierge", "bellhop", "housekeeping",
    "destination", "landmark", "monument", "attraction", "sightseeing", "scenery", "landscape", "souvenir", "heritage", "wonder",
    "explore", "discover", "wander", "roam", "trek", "hike", "backpack", "lodge", "sojourn", "relocate",
    "delay", "cancellation", "turbulence", "jetlag", "connection", "layover", "transit", "emergency", "lost", "refund",
    "domestic", "international", "overseas", "exotic", "picturesque", "scenic", "remote", "bustling", "hospitable", "breathtaking"
]

DECKS['en-shopping-commerce'] = [
    "shopping", "market", "supermarket", "mall", "boutique", "outlet", "bazaar", "counter", "aisle", "checkout",
    "customer", "consumer", "shopper", "client", "buyer", "purchaser", "cashier", "clerk", "vendor", "merchant",
    "product", "item", "goods", "merchandise", "commodity", "inventory", "stock", "supply", "variety", "selection",
    "price", "cost", "charge", "rate", "fee", "tariff", "estimate", "quote", "total", "subtotal",
    "discount", "sale", "bargain", "clearance", "promotion", "voucher", "coupon", "rebate", "special", "deal",
    "purchase", "buy", "acquire", "order", "reorder", "procure", "spend", "invest", "afford", "browse",
    "receipt", "invoice", "bill", "slip", "proof", "record", "statement", "stub", "warranty", "guarantee",
    "refund", "exchange", "replacement", "return", "compensation", "credit", "reimbursement", "cancellation", "defect", "damage",
    "cash", "card", "contactless", "credit", "debit", "wallet", "installment", "payment", "transaction", "currency",
    "deliver", "ship", "freight", "courier", "package", "parcel", "dispatch", "tracking", "handling", "logistics",
    "brand", "label", "trademark", "counterfeit", "authentic", "genuine", "imitation", "luxury", "economical", "durable"
]

DECKS['en-transport-traffic'] = [
    "transport", "traffic", "transit", "travel", "commute", "motion", "journey", "flow", "congestion", "gridlock",
    "vehicle", "car", "automobile", "bus", "coach", "subway", "metro", "tram", "train", "railway",
    "bicycle", "motorcycle", "scooter", "truck", "lorry", "van", "taxi", "cab", "ferry", "vessel",
    "station", "terminal", "stop", "platform", "depot", "harbor", "port", "airport", "stand", "shelter",
    "road", "street", "highway", "freeway", "motorway", "avenue", "lane", "alley", "route", "bypass",
    "intersection", "junction", "crossroad", "roundabout", "crossing", "crosswalk", "pedestrian", "overpass", "underpass", "bridge",
    "driver", "motorist", "chauffeur", "passenger", "commuter", "conductor", "pilot", "cyclist", "pedestrian", "bystander",
    "speed", "limit", "violation", "ticket", "fine", "penalty", "license", "permit", "registration", "inspection",
    "fare", "ticket", "pass", "toll", "charge", "card", "boarding", "schedule", "timetable", "frequency",
    "delay", "accident", "collision", "crash", "breakdown", "hazard", "detour", "diversion", "construction", "repair"
]

DECKS['en-technology-digital'] = [
    "technology", "digital", "electronic", "virtual", "cyber", "automated", "smart", "online", "connected", "wireless",
    "computer", "laptop", "desktop", "tablet", "smartphone", "device", "gadget", "server", "workstation", "terminal",
    "hardware", "software", "firmware", "processor", "chip", "circuit", "memory", "storage", "drive", "sensor",
    "screen", "display", "monitor", "keyboard", "mouse", "touchpad", "cable", "charger", "battery", "adapter",
    "internet", "network", "web", "cloud", "broadband", "bandwidth", "signal", "router", "modem", "hotspot",
    "application", "app", "program", "system", "platform", "browser", "engine", "interface", "protocol", "algorithm",
    "data", "database", "file", "folder", "document", "archive", "backup", "cache", "cookie", "stream",
    "code", "programming", "developer", "engineer", "framework", "library", "syntax", "script", "command", "debug",
    "account", "user", "profile", "password", "credential", "authentication", "permission", "access", "login", "logout",
    "security", "privacy", "protection", "firewall", "encryption", "antivirus", "malware", "virus", "hacker", "breach",
    "download", "upload", "install", "update", "upgrade", "synchronize", "browse", "search", "navigate", "configure"
]

DECKS['en-finance-banking'] = [
    "finance", "banking", "economy", "fiscal", "monetary", "commercial", "corporate", "personal", "financial", "economic",
    "bank", "institution", "branch", "vault", "atm", "counter", "teller", "banker", "adviser", "accountant",
    "account", "savings", "checking", "current", "deposit", "withdrawal", "balance", "statement", "ledger", "overdraft",
    "money", "cash", "currency", "coin", "note", "bill", "fund", "capital", "asset", "liquidity",
    "transaction", "transfer", "remittance", "payment", "wire", "clearance", "settlement", "fee", "commission", "charge",
    "loan", "credit", "debit", "mortgage", "debt", "borrower", "lender", "creditor", "debtor", "collateral",
    "interest", "rate", "yield", "principal", "maturity", "dividend", "profit", "gain", "revenue", "loss",
    "invest", "investment", "investor", "portfolio", "stock", "share", "equity", "bond", "security", "market",
    "inflation", "deflation", "recession", "depression", "growth", "boom", "crisis", "index", "benchmark", "forecast",
    "tax", "taxation", "income", "revenue", "deduction", "exemption", "return", "audit", "liability", "levy"
]

DECKS['en-daily-conversation'] = [
    "hello", "goodbye", "please", "thanks", "welcome", "pardon", "apology", "congratulations", "compliment", "greeting",
    "conversation", "dialogue", "chat", "gossip", "discussion", "debate", "opinion", "argument", "whisper", "rumor",
    "friend", "neighbor", "companion", "pal", "buddy", "mate", "acquaintance", "stranger", "guest", "host",
    "morning", "noon", "afternoon", "evening", "night", "midnight", "dawn", "dusk", "sunrise", "sunset",
    "today", "tomorrow", "yesterday", "weekend", "weekday", "holiday", "vacation", "schedule", "routine", "habit",
    "weather", "climate", "sunny", "rainy", "cloudy", "windy", "stormy", "snowy", "foggy", "humid",
    "feel", "emotion", "happy", "sad", "angry", "excited", "nervous", "anxious", "confident", "curious",
    "laugh", "smile", "cry", "sigh", "yawn", "cough", "sneeze", "nod", "shrug", "wave",
    "hobby", "interest", "leisure", "entertainment", "recreation", "sport", "game", "music", "movie", "book",
    "cook", "clean", "wash", "sweep", "tidy", "repair", "decorate", "organize", "relax", "sleep"
]

def main():
    out_path = 'db/ops/data/en-decks-wanted-20261028.tsv'
    total_items = 0
    with open(out_path, 'w', encoding='utf-8') as f:
        for slug, lemmas in DECKS.items():
            # Deduplicate preserving order
            seen = set()
            clean_lemmas = []
            for lem in lemmas:
                lem_clean = lem.strip().lower()
                if lem_clean and lem_clean not in seen:
                    seen.add(lem_clean)
                    clean_lemmas.append(lem_clean)
            
            for lem in clean_lemmas:
                f.write(f'{slug}\t{lem}\n')
                total_items += 1
            print(f'{slug}: {len(clean_lemmas)} lemmas')
            
    print(f'Total items written: {total_items} across {len(DECKS)} decks.')

if __name__ == '__main__':
    main()
