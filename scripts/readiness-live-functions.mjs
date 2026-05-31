import ts from 'typescript';

export const expectedLiveFunctionsRuntime = 'nodejs22';
export const defaultLiveHttpsRegion = 'us-central1';

export const liveFunctionDeploymentReadyLabel =
  'Live Firebase deployment includes required active Stripe and tax receipt Functions on Node.js 22 with exact secret bindings';

export const liveFunctionSourceManifestReadyLabel =
  'Live Firebase Function deployment manifest matches local Function exports, regions, triggers, schedules, retry policies, and secret declarations';

export const liveSchedulerJobReadyLabel =
  'Live Cloud Scheduler jobs for tax receipt automation are enabled with the expected cadence, timezone, and retry policy';

export const requiredLiveStripeTaxReceiptFunctions = [
  { id: 'createStripeCheckoutSession', region: 'us-central1', trigger: 'callable', secrets: ['STRIPE_SECRET_KEY'] },
  { id: 'createStripePaymentIntent', region: 'us-central1', trigger: 'callable' },
  { id: 'stripeWebhook', region: 'us-central1', trigger: 'https', secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  { id: 'sendTaxReceipt', region: 'us-central1', trigger: 'callable', secrets: ['RESEND_API_KEY'] },
  { id: 'sendCorrectedTaxReceipt', region: 'us-central1', trigger: 'callable', secrets: ['RESEND_API_KEY'] },
  { id: 'sendAnnualTaxReceipt', region: 'us-central1', trigger: 'callable', secrets: ['RESEND_API_KEY'] },
  { id: 'sendCorrectedAnnualTaxReceipt', region: 'us-central1', trigger: 'callable', secrets: ['RESEND_API_KEY'] },
  { id: 'downloadTaxReceiptPdf', region: 'us-central1', trigger: 'callable' },
  { id: 'sendChurchAnnualTaxReceipts', region: 'us-central1', trigger: 'callable', secrets: ['RESEND_API_KEY'] },
  { id: 'sendChurchCorrectedAnnualTaxReceipts', region: 'us-central1', trigger: 'callable', secrets: ['RESEND_API_KEY'] },
  {
    id: 'prepareYearEndAnnualTaxReceipts',
    region: 'us-central1',
    trigger: 'scheduled',
    schedule: 'every 24 hours',
    timeZone: 'Etc/UTC',
    retryCount: 0,
    secrets: ['RESEND_API_KEY'],
  },
  { id: 'getPaymentOperationsReadiness', region: 'us-central1', trigger: 'callable', secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY'] },
  { id: 'getTaxReceiptAuditEvents', region: 'us-central1', trigger: 'callable' },
  { id: 'getChurchPaymentSettings', region: 'us-central1', trigger: 'callable' },
  { id: 'updateChurchPaymentSettingsAsSuperAdmin', region: 'us-central1', trigger: 'callable', secrets: ['STRIPE_SECRET_KEY'] },
  { id: 'createChurchStripeConnectAccountAsSuperAdmin', region: 'us-central1', trigger: 'callable', secrets: ['STRIPE_SECRET_KEY'] },
  { id: 'createChurchStripeConnectOnboardingLink', region: 'us-central1', trigger: 'callable', secrets: ['STRIPE_SECRET_KEY'] },
  { id: 'getChurchStripeConnectSetupStatus', region: 'us-central1', trigger: 'callable' },
  { id: 'onGivingCreated', region: 'northamerica-northeast2', trigger: 'event' },
  { id: 'onGivingCompleted', region: 'northamerica-northeast2', trigger: 'event', secrets: ['RESEND_API_KEY'] },
];

const sensitiveLiveFunctionNamePattern = /stripe|payment|checkout|receipt|giving/i;

export function isSensitiveStripeTaxReceiptFunctionId(id) {
  return typeof id === 'string' && sensitiveLiveFunctionNamePattern.test(id);
}

export function functionTriggerKind(fn) {
  if (fn?.callableTrigger !== undefined) return 'callable';
  if (fn?.httpsTrigger !== undefined) return 'https';
  if (fn?.eventTrigger !== undefined) return 'event';
  if (fn?.scheduleTrigger !== undefined) return 'scheduled';
  return 'unknown';
}

export function functionRuntime(fn) {
  return typeof fn?.runtime === 'string' ? fn.runtime : '';
}

export function functionState(fn) {
  return typeof fn?.state === 'string' ? fn.state : '';
}

export function firebaseSecretName(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  const secretResourceMatch = normalized.match(/(?:^|\/)secrets\/([^/]+)/);
  if (secretResourceMatch) return secretResourceMatch[1];
  if (normalized.includes('/')) {
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  }
  return normalized;
}

export function deployedFunctionSecretNames(fn) {
  const secretEnvironmentVariables = Array.isArray(fn?.secretEnvironmentVariables)
    ? fn.secretEnvironmentVariables
    : [];
  return new Set(
    secretEnvironmentVariables
      .flatMap((entry) => [
        entry?.key,
        entry?.secret,
        entry?.secretName,
        entry?.name,
      ])
      .map(firebaseSecretName)
      .filter((value) => value.length > 0)
  );
}

function functionDeploymentKey(fn) {
  return `${fn.id}:${fn.region}`;
}

function functionDeploymentLabel(fn) {
  return `${fn.id} in ${fn.region || 'unknown region'}`;
}

function expectedScheduleRequirements(requiredFunctions) {
  return requiredFunctions
    .filter(({ trigger }) => trigger === 'scheduled')
    .filter(({ schedule, timeZone }) => typeof schedule === 'string' && typeof timeZone === 'string');
}

export function liveSchedulerJobNameForRequirement(projectId, requirement) {
  return `projects/${projectId}/locations/${requirement.region}/jobs/firebase-schedule-${requirement.id}-${requirement.region}`;
}

export function requiredLiveSchedulerJobs(
  projectId,
  requiredFunctions = requiredLiveStripeTaxReceiptFunctions
) {
  return expectedScheduleRequirements(requiredFunctions)
    .map((requirement) => ({
      id: requirement.id,
      name: liveSchedulerJobNameForRequirement(projectId, requirement),
      schedule: requirement.schedule,
      timeZone: requirement.timeZone,
      retryCount: requirement.retryCount,
    }));
}

function schedulerJobRetryCount(job) {
  const retryCount = job?.retryConfig?.retryCount;
  return typeof retryCount === 'number' && Number.isFinite(retryCount) ? retryCount : 0;
}

function liveSchedulerJobDetail(result) {
  return [
    result.missingSchedulerJobs.length > 0 ? `missing: ${result.missingSchedulerJobs.join(', ')}` : '',
    result.scheduleMismatchedSchedulerJobs.length > 0
      ? `schedule: ${result.scheduleMismatchedSchedulerJobs.join('; ')}`
      : '',
    result.timeZoneMismatchedSchedulerJobs.length > 0
      ? `timezone: ${result.timeZoneMismatchedSchedulerJobs.join('; ')}`
      : '',
    result.stateMismatchedSchedulerJobs.length > 0
      ? `state: ${result.stateMismatchedSchedulerJobs.join('; ')}`
      : '',
    result.retryMismatchedSchedulerJobs.length > 0
      ? `retry: ${result.retryMismatchedSchedulerJobs.join('; ')}`
      : '',
  ].filter(Boolean).join(' | ');
}

export function evaluateLiveSchedulerJobs(
  schedulerJobList,
  {
    projectId,
    requiredFunctions = requiredLiveStripeTaxReceiptFunctions,
  } = {}
) {
  const schedulerJobs = new Map(
    (Array.isArray(schedulerJobList) ? schedulerJobList : [])
      .map((job) => [job.name, job])
      .filter(([name]) => typeof name === 'string' && name.length > 0)
  );
  const requirements = requiredLiveSchedulerJobs(projectId, requiredFunctions);
  const missingSchedulerJobs = requirements
    .filter(({ name }) => !schedulerJobs.has(name))
    .map(({ id, name }) => `${id} expected ${name}`);
  const scheduleMismatchedSchedulerJobs = requirements
    .filter(({ name, schedule }) => {
      const job = schedulerJobs.get(name);
      return job && job.schedule !== schedule;
    })
    .map(({ id, name, schedule }) => {
      const job = schedulerJobs.get(name);
      return `${id} expected ${schedule}, got ${job.schedule || 'unknown schedule'} (${name})`;
    });
  const timeZoneMismatchedSchedulerJobs = requirements
    .filter(({ name, timeZone }) => {
      const job = schedulerJobs.get(name);
      return job && job.timeZone !== timeZone;
    })
    .map(({ id, name, timeZone }) => {
      const job = schedulerJobs.get(name);
      return `${id} expected ${timeZone}, got ${job.timeZone || 'unknown timezone'} (${name})`;
    });
  const stateMismatchedSchedulerJobs = requirements
    .filter(({ name }) => {
      const job = schedulerJobs.get(name);
      return job && job.state !== 'ENABLED';
    })
    .map(({ id, name }) => {
      const job = schedulerJobs.get(name);
      return `${id} expected ENABLED, got ${job.state || 'unknown state'} (${name})`;
    });
  const retryMismatchedSchedulerJobs = requirements
    .filter(({ name, retryCount }) => {
      const job = schedulerJobs.get(name);
      return job && typeof retryCount === 'number' && schedulerJobRetryCount(job) !== retryCount;
    })
    .map(({ id, name, retryCount }) => {
      const job = schedulerJobs.get(name);
      return `${id} expected retryCount ${retryCount}, got ${schedulerJobRetryCount(job)} (${name})`;
    });
  const ok = missingSchedulerJobs.length === 0
    && scheduleMismatchedSchedulerJobs.length === 0
    && timeZoneMismatchedSchedulerJobs.length === 0
    && stateMismatchedSchedulerJobs.length === 0
    && retryMismatchedSchedulerJobs.length === 0;
  const result = {
    ok,
    missingSchedulerJobs,
    scheduleMismatchedSchedulerJobs,
    timeZoneMismatchedSchedulerJobs,
    stateMismatchedSchedulerJobs,
    retryMismatchedSchedulerJobs,
  };

  return {
    ...result,
    detail: liveSchedulerJobDetail(result),
  };
}

export function liveFunctionDeploymentDetail(result) {
  return [
    result.missingFunctions.length > 0 ? `missing: ${result.missingFunctions.join(', ')}` : '',
    result.mismatchedFunctions.length > 0 ? `mismatched: ${result.mismatchedFunctions.join('; ')}` : '',
    result.runtimeMismatchedFunctions.length > 0 ? `runtime: ${result.runtimeMismatchedFunctions.join('; ')}` : '',
    result.stateMismatchedFunctions.length > 0 ? `state: ${result.stateMismatchedFunctions.join('; ')}` : '',
    result.secretMismatchedFunctions.length > 0 ? `secrets: ${result.secretMismatchedFunctions.join('; ')}` : '',
    result.unexpectedSecretMismatchedFunctions.length > 0
      ? `unexpected secrets: ${result.unexpectedSecretMismatchedFunctions.join('; ')}`
      : '',
    result.unexpectedSensitiveFunctionDeployments.length > 0
      ? `unexpected sensitive deployments: ${result.unexpectedSensitiveFunctionDeployments.join(', ')}`
      : '',
    result.unexpectedSensitiveFunctions.length > 0
      ? `unexpected sensitive functions: ${result.unexpectedSensitiveFunctions.join(', ')}`
      : '',
  ].filter(Boolean).join(' | ');
}

export function evaluateLiveFunctionDeployment(
  deployedFunctionList,
  {
    expectedRuntime = expectedLiveFunctionsRuntime,
    requiredFunctions = requiredLiveStripeTaxReceiptFunctions,
  } = {}
) {
  const deployedFunctionEntries = (Array.isArray(deployedFunctionList) ? deployedFunctionList : [])
    .filter((fn) => typeof fn?.id === 'string' && fn.id.length > 0);
  const deployedFunctions = new Map(deployedFunctionEntries.map((fn) => [fn.id, fn]));
  const deployedFunctionForRequirement = ({ id, region }) =>
    deployedFunctionEntries.find((fn) => fn.id === id && fn.region === region) ?? deployedFunctions.get(id);
  const requiredFunctionIds = new Set(requiredFunctions.map(({ id }) => id));
  const requiredFunctionDeploymentKeys = new Set(requiredFunctions.map(functionDeploymentKey));
  const missingFunctions = requiredFunctions
    .filter(({ id }) => !deployedFunctions.has(id))
    .map(({ id }) => id);
  const mismatchedFunctions = requiredFunctions
    .filter(({ id, region, trigger }) => {
      const deployed = deployedFunctionForRequirement({ id, region });
      return deployed && (deployed.region !== region || functionTriggerKind(deployed) !== trigger);
    })
    .map(({ id, region, trigger }) => {
      const deployed = deployedFunctionForRequirement({ id, region });
      return `${id} expected ${region}/${trigger}, got ${deployed.region}/${functionTriggerKind(deployed)}`;
    });
  const runtimeMismatchedFunctions = requiredFunctions
    .filter(({ id, region }) => {
      const deployed = deployedFunctionForRequirement({ id, region });
      return deployed && functionRuntime(deployed) !== expectedRuntime;
    })
    .map(({ id, region }) => {
      const deployed = deployedFunctionForRequirement({ id, region });
      return `${id} expected ${expectedRuntime}, got ${functionRuntime(deployed) || 'unknown runtime'}`;
    });
  const stateMismatchedFunctions = requiredFunctions
    .filter(({ id, region }) => {
      const deployed = deployedFunctionForRequirement({ id, region });
      return deployed && functionState(deployed) !== 'ACTIVE';
    })
    .map(({ id, region }) => {
      const deployed = deployedFunctionForRequirement({ id, region });
      return `${id} expected ACTIVE, got ${functionState(deployed) || 'unknown state'}`;
    });
  const secretMismatchedFunctions = requiredFunctions
    .filter(({ id, region, secrets = [] }) => {
      const deployed = deployedFunctionForRequirement({ id, region });
      if (!deployed || secrets.length === 0) return false;
      const deployedSecrets = deployedFunctionSecretNames(deployed);
      return secrets.some((secret) => !deployedSecrets.has(secret));
    })
    .map(({ id, region, secrets = [] }) => {
      const deployed = deployedFunctionForRequirement({ id, region });
      const deployedSecrets = deployedFunctionSecretNames(deployed);
      const missingSecrets = secrets.filter((secret) => !deployedSecrets.has(secret));
      return `${id} missing ${missingSecrets.join(', ')}`;
    });
  const unexpectedSecretMismatchedFunctions = requiredFunctions
    .filter(({ id, region, secrets = [] }) => {
      const deployed = deployedFunctionForRequirement({ id, region });
      if (!deployed) return false;
      const expectedSecrets = new Set(secrets);
      return Array.from(deployedFunctionSecretNames(deployed))
        .some((secret) => !expectedSecrets.has(secret));
    })
    .map(({ id, region, secrets = [] }) => {
      const deployed = deployedFunctionForRequirement({ id, region });
      const expectedSecrets = new Set(secrets);
      const unexpectedSecrets = Array.from(deployedFunctionSecretNames(deployed))
        .filter((secret) => !expectedSecrets.has(secret));
      return `${id} has unexpected ${unexpectedSecrets.join(', ')}`;
    });
  const unexpectedSensitiveFunctionDeployments = deployedFunctionEntries
    .filter((fn) => isSensitiveStripeTaxReceiptFunctionId(fn.id))
    .filter((fn) => !requiredFunctionDeploymentKeys.has(functionDeploymentKey(fn)))
    .map(functionDeploymentLabel)
    .sort();
  const unexpectedSensitiveFunctions = Array.from(deployedFunctions.keys())
    .filter((id) => !requiredFunctionIds.has(id) && isSensitiveStripeTaxReceiptFunctionId(id))
    .sort();
  const ok = missingFunctions.length === 0
    && mismatchedFunctions.length === 0
    && runtimeMismatchedFunctions.length === 0
    && stateMismatchedFunctions.length === 0
    && secretMismatchedFunctions.length === 0
    && unexpectedSecretMismatchedFunctions.length === 0
    && unexpectedSensitiveFunctionDeployments.length === 0
    && unexpectedSensitiveFunctions.length === 0;

  const result = {
    ok,
    missingFunctions,
    mismatchedFunctions,
    runtimeMismatchedFunctions,
    stateMismatchedFunctions,
    secretMismatchedFunctions,
    unexpectedSecretMismatchedFunctions,
    unexpectedSensitiveFunctionDeployments,
    unexpectedSensitiveFunctions,
  };

  return {
    ...result,
    detail: liveFunctionDeploymentDetail(result),
  };
}

function parseTypeScriptSource(source, fileName) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function propertyNameText(name) {
  if (!name) return '';
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return '';
}

function stringValueFromNode(node, constants) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return stringValueFromNode(node.expression, constants);
  }
  if (ts.isIdentifier(node)) {
    return constants[node.text] ?? null;
  }
  return null;
}

function numberValueFromNode(node, constants) {
  if (!node) return null;
  if (ts.isNumericLiteral(node)) {
    const parsed = Number(node.text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return numberValueFromNode(node.expression, constants);
  }
  if (ts.isIdentifier(node)) {
    const value = constants[node.text];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  return null;
}

function objectProperty(node, propertyName) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name) === propertyName) return property.initializer;
  }
  return null;
}

function stringArrayValues(node, constants) {
  if (!node || !ts.isArrayLiteralExpression(node)) return [];
  return node.elements
    .map((element) => stringValueFromNode(element, constants))
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function callExpressionIdentifierName(node) {
  if (!ts.isIdentifier(node.expression)) return '';
  return node.expression.text;
}

function triggerFromCalleeName(calleeName) {
  if (calleeName === 'onCall') return 'callable';
  if (calleeName === 'onRequest') return 'https';
  if (calleeName === 'onSchedule') return 'scheduled';
  if (calleeName.startsWith('onDocument')) return 'event';
  return '';
}

function declarationFromInitializer(name, initializer, constants) {
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  const trigger = triggerFromCalleeName(callExpressionIdentifierName(initializer));
  if (!trigger) return null;

  const options = initializer.arguments[0];
  const region = stringValueFromNode(objectProperty(options, 'region'), constants) ?? defaultLiveHttpsRegion;
  const secrets = stringArrayValues(objectProperty(options, 'secrets'), constants);
  const schedule = trigger === 'scheduled'
    ? (stringValueFromNode(objectProperty(options, 'schedule'), constants) ?? stringValueFromNode(options, constants))
    : null;
  const timeZone = trigger === 'scheduled'
    ? stringValueFromNode(objectProperty(options, 'timeZone'), constants)
    : null;
  const retryCount = trigger === 'scheduled'
    ? numberValueFromNode(objectProperty(options, 'retryCount'), constants)
    : null;

  return {
    id: name,
    region,
    trigger,
    ...(schedule ? { schedule } : {}),
    ...(timeZone ? { timeZone } : {}),
    ...(retryCount !== null ? { retryCount } : {}),
    secrets,
  };
}

export function exportedFunctionNamesFromIndexSource(source) {
  const sourceFile = parseTypeScriptSource(source, 'functions/src/index.ts');
  const exports = new Set();
  sourceFile.forEachChild((node) => {
    if (!ts.isExportDeclaration(node)) return;
    const namedExports = node.exportClause;
    if (!namedExports || !ts.isNamedExports(namedExports)) return;
    for (const element of namedExports.elements) {
      exports.add(element.name.text);
    }
  });
  return exports;
}

export function stringConstantsFromSource(source, fileName = 'source.ts') {
  const sourceFile = parseTypeScriptSource(source, fileName);
  const constants = {};
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const value = stringValueFromNode(declaration.initializer, constants);
      if (value) constants[declaration.name.text] = value;
    }
  });
  return constants;
}

export function functionDeploymentDeclarationsFromSource(source, constants = {}, fileName = 'source.ts') {
  const sourceFile = parseTypeScriptSource(source, fileName);
  const declarations = new Map();
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    const exported = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (!exported) return;
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const deploymentDeclaration = declarationFromInitializer(
        declaration.name.text,
        declaration.initializer,
        constants
      );
      if (deploymentDeclaration) {
        declarations.set(deploymentDeclaration.id, deploymentDeclaration);
      }
    }
  });
  return declarations;
}

function sortedSecretList(secrets = []) {
  return [...secrets].sort();
}

function formatSecrets(secrets = []) {
  const sorted = sortedSecretList(secrets);
  return sorted.length > 0 ? sorted.join(', ') : 'none';
}

function scheduleExpectation(requirement) {
  if (
    requirement.trigger !== 'scheduled'
    && !requirement.schedule
    && !requirement.timeZone
    && requirement.retryCount === undefined
  ) {
    return '';
  }
  return [
    ` schedule ${requirement.schedule || 'none'}`,
    ` timezone ${requirement.timeZone || 'none'}`,
    ` retryCount ${requirement.retryCount ?? 'none'}`,
  ].join('');
}

function functionRequirementEquivalent(requirement, declaration) {
  if (!declaration) return false;
  if (requirement.region !== declaration.region || requirement.trigger !== declaration.trigger) return false;
  const expectedSecrets = sortedSecretList(requirement.secrets);
  const actualSecrets = sortedSecretList(declaration.secrets);
  return expectedSecrets.length === actualSecrets.length
    && expectedSecrets.every((secret, index) => secret === actualSecrets[index])
    && (requirement.schedule === undefined || requirement.schedule === declaration.schedule)
    && (requirement.timeZone === undefined || requirement.timeZone === declaration.timeZone)
    && (requirement.retryCount === undefined || requirement.retryCount === declaration.retryCount);
}

export function liveFunctionSourceManifestDetail(result) {
  return [
    result.missingExports.length > 0 ? `missing exports: ${result.missingExports.join(', ')}` : '',
    result.missingSourceDeclarations.length > 0
      ? `missing source declarations: ${result.missingSourceDeclarations.join(', ')}`
      : '',
    result.sourceMismatchedFunctions.length > 0
      ? `source mismatches: ${result.sourceMismatchedFunctions.join('; ')}`
      : '',
  ].filter(Boolean).join(' | ');
}

export function evaluateLiveFunctionManifestSourceAlignment({
  indexSource,
  functionSources,
  constantSources = [],
  requiredFunctions = requiredLiveStripeTaxReceiptFunctions,
}) {
  const exportedFunctions = exportedFunctionNamesFromIndexSource(indexSource ?? '');
  const constants = Object.assign(
    {},
    ...constantSources.map((source, index) => stringConstantsFromSource(source ?? '', `constants-${index}.ts`))
  );
  const declarations = new Map();
  for (const [index, source] of functionSources.entries()) {
    for (const [id, declaration] of functionDeploymentDeclarationsFromSource(
      source ?? '',
      constants,
      `functions-${index}.ts`
    )) {
      declarations.set(id, declaration);
    }
  }

  const missingExports = requiredFunctions
    .filter(({ id }) => !exportedFunctions.has(id))
    .map(({ id }) => id);
  const missingSourceDeclarations = requiredFunctions
    .filter(({ id }) => !declarations.has(id))
    .map(({ id }) => id);
  const sourceMismatchedFunctions = requiredFunctions
    .filter((requirement) => {
      const declaration = declarations.get(requirement.id);
      return declaration && !functionRequirementEquivalent(requirement, declaration);
    })
    .map((requirement) => {
      const declaration = declarations.get(requirement.id);
      return `${requirement.id} expected ${requirement.region}/${requirement.trigger} secrets ${formatSecrets(requirement.secrets)}${scheduleExpectation(requirement)}, got ${declaration.region}/${declaration.trigger} secrets ${formatSecrets(declaration.secrets)}${scheduleExpectation(declaration)}`;
    });
  const ok = missingExports.length === 0
    && missingSourceDeclarations.length === 0
    && sourceMismatchedFunctions.length === 0;
  const result = {
    ok,
    missingExports,
    missingSourceDeclarations,
    sourceMismatchedFunctions,
  };

  return {
    ...result,
    detail: liveFunctionSourceManifestDetail(result),
  };
}
