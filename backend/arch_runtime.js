require('dotenv').config();
const claudeCodeRunner = require('./src/agents/claudeCodeRunner');

const startTime = Date.now();
const log = (msg) => console.log(`[+${((Date.now() - startTime) / 1000).toFixed(2)}s] ${msg}`);

log('Starting ARCH runtime test with new 5-min timeout');
log(`maxTurnsForRole(ARCH)=${claudeCodeRunner._internal.maxTurnsForRole('architecture-agent')}`);
log(`timeoutMsForRole(ARCH)=${claudeCodeRunner._internal.timeoutMsForRole('architecture-agent', 1_800_000)}ms`);

(async () => {
  try {
    const result = await claudeCodeRunner.runAgent({
      role: 'architecture-agent',
      repoPath: null,
      taskId: 'arch-runtime-' + Date.now(),
      context: {
        featureRequest: {
          title: 'Add login page',
          description: 'Add a simple login page with email + password',
        },
      },
      onGate: async (toolName, input) => {
        log(`GATE: ${toolName}`);
        return { behavior: 'allow', updatedInput: input };
      },
    });
    log(`✅ runAgent returned in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    log(`Output keys: ${Object.keys(result.output).join(', ')}`);
    log(`architecture_brief length: ${result.output.architecture_brief?.length}`);
    log(`numTurns=${result.messages?.length}`);
    process.exit(0);
  } catch (err) {
    log(`❌ FAIL after ${((Date.now() - startTime) / 1000).toFixed(1)}s: ${err.message}`);
    log(`  code=${err.code} subtype=${err.subtype} numTurns=${err.numTurns} stopReason=${err.stopReason}`);
    if (err.rawResult) log(`  rawResult first 300: ${String(err.rawResult).slice(0, 300)}`);
    process.exit(1);
  }
})();
