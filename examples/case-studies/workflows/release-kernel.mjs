import { createEvidenceAlgebra } from '../../../src/compiler.mjs';

/** Build a law-aware preflight contract. Receipt authenticity is outside this model. */
export function releaseKernel() {
  const privateFacts = createEvidenceAlgebra(['buildCurrent', 'testsPass', 'artifactCurrent', 'approved']);
  const [build, tests, artifact, approval] = privateFacts.atoms.map(n => privateFacts.atom(n));
  const ci = privateFacts.all([build, tests]);
  const presentation = privateFacts.present([
    { atom: 'ciReady', value: ci },
    { atom: 'testedBuild', value: ci }, // Two consuming systems name the same condition.
    { atom: 'artifactReady', value: privateFacts.all([build, artifact]) },
    { atom: 'approval', value: approval },
  ]);
  const guarantee = presentation.atom('ciReady');
  const target = presentation.all([guarantee, presentation.atom('artifactReady'), presentation.atom('approval')]);
  const additional = presentation.residual(guarantee, target);
  return { presentation, sources: [
    presentation.sourcePrivate('workflow_ci', guarantee),
    presentation.sourcePrivate('workflow_additional', additional),
    presentation.source('workflow_claims', presentation.always),
    { name: 'release.kernel.ass', source: `
      fn release_count = x -> x >= 0 && x <= 1000000000 && floor x == x;
      export fn receipt_facts = (buildCurrent:Bool) -> (passed:Num) -> (failed:Num) ->
        (minimum:Num) -> (artifactCurrent:Bool) -> (approved:Bool) ->
        require (release_count passed && release_count failed && release_count minimum && minimum > 0) {
          buildCurrent, testsPass:passed >= minimum && failed == 0, artifactCurrent, approved
        };
      export fn decision = (facts:{buildCurrent:Bool,testsPass:Bool,artifactCurrent:Bool,approved:Bool}) -> do {
        let ci = workflow_ci facts;
        {ready:ci && workflow_additional facts, ciReady:ci}
      };
      export fn validate_claims = (claims:{ciReady:Bool,testedBuild:Bool,artifactReady:Bool,approval:Bool}) ->
        workflow_claims claims;
    ` },
  ] };
}
