export const TOPIC_WORDS =
  /\b(medicine|medicines|medication|meds?|dose|doses|pill|pills|tablet|capsule|gamot|inom|schedule|remind|reminder|missed|forgot|nakalimutan|late|adherence|progress|streak|doctor|check-?up|appointment|lab|result|side ?effects?|dizzy|nausea|rash|allerg|pain|caretrack|health|tip|tips|course|refill|today|tomorrow|next|ngayon|bukas|doing|how am i|kumusta ako|my (rate|score|record))\b/i;
export const EMERGENCY = /\b(chest pain|can'?t breathe|cannot breathe|difficulty breathing|overdose|suicid|unconscious|seizure|severe bleeding|hirap huminga|sumasakit ang dibdib|sobrang dugo)\b/i;
export const INJECTION_REQUEST = /\b(shot|inject|injection|injectable|turok|magpaturok)\b/i;
export const PROMPT_INJECTION = /\b(ignore (all |any |previous )?instructions|forget (all |your )?instructions|reveal (the )?system prompt|act as .*system)\b/i;
export const CRISIS = /\b(suicid|want to die|kill myself|hurt myself|ayoko na|gusto ko nang mamatay)\b/i;
export const RESTRICTED_MEDICAL_REQUEST = /\b(diagnose|diagnosis|what disease|prescribe|what (medicine|medication) should i take|increase (my )?dose|decrease (my )?dose|double (my |a )?dose|take two|stop taking|can i stop|change my medication|replace my medicine|mix with alcohol|safe in pregnancy|dose for my child|anong sakit ko)\b/i;
export const OUTPUT_DANGER = /\b(take a double dose|double (your|the|my) dose|increase (your|the) dose|stop taking your medicine|stop your medicine)\b/i;

