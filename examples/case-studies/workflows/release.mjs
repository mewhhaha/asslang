import { compileSources } from '../../../src/compiler.mjs';
import { createRuntime } from '../../../src/abi.mjs';
import { releaseKernel } from './release-kernel.mjs';
import { record, integer, boolean, text, lowering, RUNTIME_PAGES } from './common.mjs';

/** Reusable pure preflight evaluator. Does not fetch, authenticate or act on receipts. */
export async function createReleaseGate(options = {}) {
  const { presentation, sources } = releaseKernel();
  const runtime = await createRuntime(compileSources(sources, lowering(options)), { pages: RUNTIME_PAGES });
  return Object.freeze({ evaluate(input) {
    record(input, ['candidate', 'ci', 'artifact', 'approval', 'claims', 'minPassed'], 'release request');
    record(input.candidate, ['revision', 'digest'], 'candidate');
    const revision = text(input.candidate.revision, 'candidate.revision');
    const digest = text(input.candidate.digest, 'candidate.digest');
    const minimum = integer(input.minPassed ?? 1, 1, 1e9, 'minPassed');
    let buildCurrent = false, artifactCurrent = false, approved = false, passed = 0, failed = 0;
    if (input.ci != null) {
      record(input.ci, ['revision', 'passed', 'failed'], 'CI receipt');
      buildCurrent = text(input.ci.revision, 'ci.revision') === revision;
      passed = integer(input.ci.passed, 0, 1e9, 'ci.passed');
      failed = integer(input.ci.failed, 0, 1e9, 'ci.failed');
    }
    if (input.artifact != null) {
      record(input.artifact, ['revision', 'digest'], 'artifact receipt');
      const artifactRevision = text(input.artifact.revision, 'artifact.revision');
      const artifactDigest = text(input.artifact.digest, 'artifact.digest');
      artifactCurrent = artifactRevision === revision && artifactDigest === digest;
    }
    if (input.approval != null) {
      record(input.approval, ['revision', 'approved'], 'approval receipt');
      const approvalRevision = text(input.approval.revision, 'approval.revision');
      approved = boolean(input.approval.approved, 'approval.approved') && approvalRevision === revision;
    }
    const facts = runtime.call('receipt_facts', [buildCurrent, passed, failed, minimum, artifactCurrent, approved]);
    const currentNames = Object.keys(facts).filter(k => facts[k]);
    const view = presentation.view(currentNames);
    const summaries = Object.fromEntries(presentation.atoms.map(n => [n, view.includes(n)]));
    if (input.claims !== undefined) {
      record(input.claims, presentation.atoms, 'public claims');
      const claims = Object.fromEntries(presentation.atoms.map(n => [n, boolean(input.claims[n], `claims.${n}`)]));
      try { runtime.call('validate_claims', [claims]); }
      catch (error) {
        if (!(error instanceof WebAssembly.RuntimeError)) throw error;
        throw new TypeError('Public claims contradict the derived interface laws', { cause: error });
      }
      if (presentation.atoms.some(n => claims[n] !== summaries[n])) throw new TypeError('Public claims do not match current receipt-derived summaries');
    }
    const result = runtime.call('decision', [facts]);
    const reasons = [];
    if (!facts.buildCurrent) reasons.push('current-ci-receipt-required');
    if (!facts.testsPass) reasons.push('passing-test-evidence-required');
    if (!facts.artifactCurrent) reasons.push('matching-artifact-required');
    if (!facts.approved) reasons.push('candidate-approval-required');
    return { revision, ready: result.ready, facts, summaries, reasons };
  } });
}
export async function evaluateRelease(input, options = {}) {
  return (await createReleaseGate(options)).evaluate(input);
}
