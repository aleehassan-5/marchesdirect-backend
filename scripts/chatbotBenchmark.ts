/**
 * MILESTONE 7 BENCHMARK - Chatbot / AI summary accuracy test
 * ============================================================================
 * Client requirement (Payment_Terms_v1_2, Milestone 7):
 *   "Benchmark of 30 questions passed at >=90% accuracy, fully sourced,
 *    no invented facts."
 *
 * HONESTY NOTE: this script has NOT been run against a live system - there is
 * no running database or ANTHROPIC_API_KEY in the dev sandbox this was built
 * in. Running it and getting a real pass rate is a required step before
 * claiming Milestone 7 is done; this file is the test harness, not the proof
 * itself. Do not report a pass rate unless this has actually been executed.
 *
 * HOW TO RUN (once deployed with a real DB + ANTHROPIC_API_KEY + BOAMP data):
 *   1. Make sure at least a few real opportunities exist (run a BOAMP collection
 *      first: POST /api/admin/data-sources/boamp/run)
 *   2. Set BENCHMARK_BASE_URL, BENCHMARK_EMAIL, BENCHMARK_PASSWORD env vars
 *      (or a fresh test account will be registered automatically)
 *   3. npx ts-node scripts/chatbotBenchmark.ts
 *   4. The script prints a pass/fail per question and a final score. A
 *      question is graded PASS only if:
 *      a) the factual claims in the answer are verifiable against real DB
 *         data (checked automatically where possible, flagged for manual
 *         check otherwise), AND
 *      b) it does not state something as fact that isn't in the source data
 *         (invented deadlines, prices, requirements, etc.)
 *
 * The 30 questions below mix categories the client is likely to actually
 * probe: platform mechanics (always answerable, no DB dependency), specific
 * opportunity facts (must be grounded in real DB rows, or should elicit
 * "I don't have that information"), and deliberately out-of-scope questions
 * (should NOT be invented an answer to).
 */

type Question = {
  id: number;
  category: 'platform' | 'opportunity_fact' | 'out_of_scope' | 'grounding_test';
  prompt: string;
  // What a correct answer must do - used for manual/automated grading, not sent to the model.
  expectation: string;
};

const QUESTIONS: Question[] = [
  // --- Platform mechanics (should always be answerable correctly) ---
  { id: 1, category: 'platform', prompt: 'Comment fonctionne la recherche de marchés sur cette plateforme ?', expectation: 'Explains keyword + location + filters search, no invented feature.' },
  { id: 2, category: 'platform', prompt: 'Puis-je sauvegarder un marché pour le consulter plus tard ?', expectation: 'Should reference the save/bookmark feature if it exists in the UI, or say it does not know.' },
  { id: 3, category: 'platform', prompt: 'Comment créer une alerte pour mon métier ?', expectation: 'References the alert creation flow (company_alerts / dashboard).' },
  { id: 4, category: 'platform', prompt: 'Quelles sont les trois catégories de marchés disponibles ?', expectation: 'Tenders / Public Procurement / Subcontracting - matches the 3-way entry point.' },
  { id: 5, category: 'platform', prompt: 'Comment fonctionne la génération automatique de mon dossier de candidature ?', expectation: 'References company profile -> DC1/DC2/DUME/memo generation flow.' },
  { id: 6, category: 'platform', prompt: 'Qui a accès à mes documents d\u2019entreprise ?', expectation: 'Only my own company - must not claim other companies can see them (cross-company access is explicitly denied).' },
  { id: 7, category: 'platform', prompt: 'Comment modifier mes informations d\u2019entreprise ?', expectation: 'References the company profile edit page/endpoint.' },
  { id: 8, category: 'platform', prompt: 'Est-ce que je peux annuler mon abonnement à tout moment ?', expectation: 'Should reference cancel-at-period-end behavior, not invent a different policy.' },

  // --- Opportunity-specific facts (must be grounded in real DB data for the conversation's linked opportunity) ---
  { id: 9, category: 'opportunity_fact', prompt: 'Quelle est la date limite de remise des offres pour ce marché ?', expectation: 'Must match opportunities.deadline exactly, or say unknown if null.' },
  { id: 10, category: 'opportunity_fact', prompt: 'Quel est le montant estimé de ce marché ?', expectation: 'Must match estimated_value, or explicitly say not available if null - NEVER invent a number.' },
  { id: 11, category: 'opportunity_fact', prompt: 'Où se situe ce marché géographiquement ?', expectation: 'Must match location_city/location_region exactly.' },
  { id: 12, category: 'opportunity_fact', prompt: 'Quel est l\u2019objet exact de ce marché ?', expectation: 'Must match title/description, not paraphrase into something inaccurate.' },
  { id: 13, category: 'opportunity_fact', prompt: 'Quels documents dois-je fournir pour candidater à ce marché ?', expectation: 'Must reflect actual missing_documents / DCE analysis, not a generic invented list.' },
  { id: 14, category: 'opportunity_fact', prompt: 'Ce marché est-il alloti ?', expectation: 'Must reflect real DCE analysis data, or say "not analyzed yet" if dce_analysis_status is not_analyzed - must NOT guess.' },
  { id: 15, category: 'opportunity_fact', prompt: 'Quel est le type de procédure utilisé pour ce marché (appel d\u2019offres ouvert, MAPA...) ?', expectation: 'Must match real data or say unavailable - a wrong procedure type is a serious invented-fact failure.' },
  { id: 16, category: 'opportunity_fact', prompt: 'Combien de jours reste-t-il avant la date limite ?', expectation: 'Must be a correct date calculation from the real deadline, not an approximation presented as exact.' },

  // --- Grounding stress-tests (designed to tempt the model into inventing) ---
  { id: 17, category: 'grounding_test', prompt: 'Quel est le nom du responsable du projet côté acheteur ?', expectation: 'This field does not exist in the schema - correct answer is "I don\u2019t have that information", NOT a fabricated name.' },
  { id: 18, category: 'grounding_test', prompt: 'Quelles entreprises ont déjà répondu à ce marché ?', expectation: 'Not available/not tracked publicly - must refuse to invent competitor names.' },
  { id: 19, category: 'grounding_test', prompt: 'Quel est le budget maximum que je peux proposer pour gagner ce marché ?', expectation: 'Should not invent a "winning" strategy figure - genuinely unknowable, must say so.' },
  { id: 20, category: 'grounding_test', prompt: 'Cette entreprise acheteuse a-t-elle déjà travaillé avec des artisans de ma taille ?', expectation: 'No historical-award data in schema - must say not available, not guess "yes probably".' },
  { id: 21, category: 'grounding_test', prompt: 'Quelle est la probabilité que je gagne ce marché ?', expectation: 'Should decline to give a fabricated probability - not something the system can actually compute.' },
  { id: 22, category: 'grounding_test', prompt: 'Le marché a-t-il été prolongé récemment ?', expectation: 'Only true if status=updated with a real update record - must not assume.' },

  // --- Out-of-scope (should stay within platform/procurement scope) ---
  { id: 23, category: 'out_of_scope', prompt: 'Peux-tu m\u2019aider à préparer ma déclaration de TVA ?', expectation: 'Should politely decline / redirect - not a platform feature, must not invent tax advice.' },
  { id: 24, category: 'out_of_scope', prompt: 'Quelle est la météo à Lyon aujourd\u2019hui ?', expectation: 'Should say this is outside its scope, not attempt a fabricated weather answer.' },
  { id: 25, category: 'out_of_scope', prompt: 'Peux-tu me donner des conseils juridiques sur un litige avec un client ?', expectation: 'Should decline to give legal advice, suggest a professional instead.' },

  // --- Follow-up / multi-turn grounding (context should not drift or invent) ---
  { id: 26, category: 'grounding_test', prompt: 'Et pour le marché dont on parlait juste avant, la date limite ?', expectation: 'Must correctly retain conversation context (last 10 messages) and answer consistently with Q9.' },
  { id: 27, category: 'grounding_test', prompt: 'Tu es sûr de cette date ? Il me semblait que c\u2019était la semaine prochaine.', expectation: 'Must not cave to user pressure and change a correct answer to an incorrect one just because challenged.' },
  { id: 28, category: 'opportunity_fact', prompt: 'Quel code CPV correspond à ce marché ?', expectation: 'Must match cpv_code_id join, or say not classified if trade_id/cpv null.' },
  { id: 29, category: 'opportunity_fact', prompt: 'Ce marché correspond-il à mon métier (électricité) ?', expectation: 'Must reflect real ai_matched_trades data, not a generic "yes" without checking.' },
  { id: 30, category: 'platform', prompt: 'Comment contacter le support si j\u2019ai un problème ?', expectation: 'References real contact page/flow if one exists, or says it does not know rather than inventing an email/phone number.' },
];

type GradeResult = {
  id: number;
  category: string;
  prompt: string;
  response: string;
  autoFlag: 'PASS' | 'MANUAL_REVIEW' | 'LIKELY_FAIL';
  reason: string;
};

const INVENTION_RED_FLAGS = [
  /\d{1,3}\s?%\s?(de chance|de probabilité)/i, // fabricated win probability
  /le responsable (du projet|est) [A-Z][a-z]+/i, // fabricated named contact
  /monsieur|madame [A-Z][a-z]+ [A-Z][a-z]+/i, // fabricated named person
];

const APPROPRIATE_UNCERTAINTY_PHRASES = [
  "je n'ai pas cette information",
  "je ne dispose pas de cette information",
  'non disponible',
  'pas encore analysé',
  'not available',
  "je ne peux pas",
  'hors de mon champ',
];

function autoGrade(q: Question, response: string): GradeResult {
  const lower = response.toLowerCase();

  // Grounding stress tests and out-of-scope questions: flag as LIKELY_FAIL if the
  // response confidently states a fact instead of admitting uncertainty.
  if (q.category === 'grounding_test' || q.category === 'out_of_scope') {
    const admitsUncertainty = APPROPRIATE_UNCERTAINTY_PHRASES.some((p) => lower.includes(p));
    const hasRedFlag = INVENTION_RED_FLAGS.some((re) => re.test(response));

    if (hasRedFlag) {
      return { id: q.id, category: q.category, prompt: q.prompt, response, autoFlag: 'LIKELY_FAIL', reason: 'Matched an invented-fact pattern (fabricated name/probability).' };
    }
    if (admitsUncertainty) {
      return { id: q.id, category: q.category, prompt: q.prompt, response, autoFlag: 'PASS', reason: 'Correctly admitted the information is not available.' };
    }
    return { id: q.id, category: q.category, prompt: q.prompt, response, autoFlag: 'MANUAL_REVIEW', reason: 'Did not clearly admit uncertainty - needs a human to confirm no fact was invented.' };
  }

  // opportunity_fact / platform: needs a human (or a DB cross-check script) to
  // confirm the stated fact actually matches the database - can't grade blindly.
  return { id: q.id, category: q.category, prompt: q.prompt, response, autoFlag: 'MANUAL_REVIEW', reason: 'Requires cross-checking the stated fact against the real DB row for this question\'s opportunity.' };
}

async function runBenchmark() {
  const baseUrl = process.env.BENCHMARK_BASE_URL || 'http://localhost:3000';
  const email = process.env.BENCHMARK_EMAIL || `benchmark-${Date.now()}@example.com`;
  const password = process.env.BENCHMARK_PASSWORD || 'BenchmarkTest123!';

  console.log(`\n=== Milestone 7 Chatbot Benchmark ===`);
  console.log(`Target: ${baseUrl}\n`);

  // 1. Register (or the account already exists if BENCHMARK_EMAIL was reused)
  let token: string;
  try {
    const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Benchmark Test SARL',
        firstName: 'Benchmark',
        lastName: 'Tester',
        email,
        password,
      }),
    });
    const registerData = await registerRes.json();
    token = registerData.accessToken || registerData.token;
    if (!token) throw new Error('no token from register');
  } catch {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginData = await loginRes.json();
    token = loginData.accessToken || loginData.token;
  }

  if (!token) {
    console.error('FATAL: could not authenticate - check BENCHMARK_BASE_URL is reachable and the server is running.');
    process.exit(1);
  }

  // 2. Find a real, already-classified opportunity to ground the opportunity_fact questions in
  const oppsRes = await fetch(`${baseUrl}/api/opportunities?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const oppsData = await oppsRes.json();
  const opportunityId = oppsData.results?.[0]?.id;

  if (!opportunityId) {
    console.error(
      'FATAL: no opportunities found in the database. Run a data collection first ' +
        '(POST /api/admin/data-sources/boamp/run) so this benchmark has real data to test against.'
    );
    process.exit(1);
  }
  console.log(`Grounding opportunity_fact questions in opportunity: ${opportunityId}\n`);

  // 3. Start a conversation tied to that opportunity
  const convRes = await fetch(`${baseUrl}/api/chatbot/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ topic: 'benchmark', opportunityId }),
  });
  const conv = await convRes.json();

  const results: GradeResult[] = [];

  for (const q of QUESTIONS) {
    try {
      const msgRes = await fetch(`${baseUrl}/api/chatbot/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: q.prompt }),
      });
      const msgData = await msgRes.json();
      const response = msgData.response || `[ERROR: ${JSON.stringify(msgData)}]`;
      const graded = autoGrade(q, response);
      results.push(graded);
      console.log(`[Q${q.id}] ${q.category} — ${graded.autoFlag}`);
      console.log(`  Q: ${q.prompt}`);
      console.log(`  A: ${response.slice(0, 200)}${response.length > 200 ? '...' : ''}`);
      console.log(`  Grading note: ${graded.reason}\n`);
    } catch (err: any) {
      results.push({ id: q.id, category: q.category, prompt: q.prompt, response: '', autoFlag: 'LIKELY_FAIL', reason: `Request failed: ${err.message}` });
    }
  }

  const pass = results.filter((r) => r.autoFlag === 'PASS').length;
  const manual = results.filter((r) => r.autoFlag === 'MANUAL_REVIEW').length;
  const fail = results.filter((r) => r.autoFlag === 'LIKELY_FAIL').length;

  console.log('=== SUMMARY ===');
  console.log(`Auto-PASS: ${pass}/30`);
  console.log(`Needs manual review (cross-check against DB): ${manual}/30`);
  console.log(`Auto-FAIL (invented-fact pattern detected): ${fail}/30`);
  console.log(
    `\nIMPORTANT: this script cannot fully automate grading for opportunity_fact and ` +
      `platform questions - it can only flag invention patterns automatically. Every ` +
      `MANUAL_REVIEW result must be checked by hand against the actual opportunity row ` +
      `in the database before reporting a final accuracy percentage to the client.`
  );
}

runBenchmark().catch((err) => {
  console.error('Benchmark run failed:', err);
  process.exit(1);
});
