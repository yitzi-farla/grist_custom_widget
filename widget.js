/* global grist */
const state = {
  row: null,
  tableId: 'Naneth_AI_Review',
};

const $ = (id) => document.getElementById(id);

function log(message) {
  const now = new Date().toLocaleTimeString();
  $('log').textContent = `[${now}] ${message}\n` + $('log').textContent;
}

function getField(row, name) {
  return row && Object.prototype.hasOwnProperty.call(row, name) ? row[name] : '';
}

function setVal(id, val) {
  $(id).value = val || '';
}
function setText(id, val) {
  $(id).textContent = val || '';
}

function hydrate(row) {
  state.row = row;
  if (!row) {
    $('title').textContent = 'Select a review row';
    return;
  }

  const group = getField(row, 'GROUP_SKU');
  $('title').textContent = group || 'Review row';
  $('meta').textContent = [
    `Status: ${getField(row, 'REVIEW_STATUS') || ''}`,
    `Needs enrichment: ${String(getField(row, 'NEEDS_ENRICHMENT'))}`,
  ].join('\n');

  setVal('prompt', getField(row, 'PROMPT'));
  setText('parentLabel', getField(row, 'PARENT_LABEL'));
  setText('varpar', getField(row, 'VARPAR_LABEL'));
  setText('variantSkus', getField(row, 'VARIANT_SKUS'));
  setText('subvariantSkus', getField(row, 'SUBVARIANT_SKUS'));

  setVal('rejectMessage', getField(row, 'REJECT_MESSAGE'));
  setVal('finalProductName', getField(row, 'FINAL_PRODUCT_NAME'));
  setVal('finalLongDescription', getField(row, 'FINAL_LONG_DESCRIPTION'));
  setVal('finalBullets', getField(row, 'FINAL_BULLETS'));
  setVal('finalSpecs', getField(row, 'FINAL_SPECS'));
  setVal('finalSources', getField(row, 'FINAL_SOURCES'));
  setVal('finalWarnings', getField(row, 'FINAL_WARNINGS'));
}

function fieldsFromForm() {
  return {
    FINAL_PRODUCT_NAME: $('finalProductName').value,
    FINAL_LONG_DESCRIPTION: $('finalLongDescription').value,
    FINAL_BULLETS: $('finalBullets').value,
    FINAL_SPECS: $('finalSpecs').value,
    FINAL_SOURCES: $('finalSources').value,
    FINAL_WARNINGS: $('finalWarnings').value,
    REJECT_MESSAGE: $('rejectMessage').value,
  };
}

async function updateCurrent(fields) {
  if (!state.row || !state.row.id) throw new Error('No selected row.');
  await grist.docApi.applyUserActions([
    ['UpdateRecord', state.tableId, state.row.id, fields]
  ]);
}

async function createRun(action, status, extra = {}) {
  if (!state.row) throw new Error('No selected row.');
  const fields = {
    GROUP_SKU: getField(state.row, 'GROUP_SKU'),
    ACTION: action,
    RUN_STATUS: status,
    PROMPT_SENT: getField(state.row, 'PROMPT'),
    HTML_URLS_SENT: getField(state.row, 'SOURCE_URLS'),
    REJECT_MESSAGE: $('rejectMessage').value,
    FINAL_PRODUCT_NAME: $('finalProductName').value,
    FINAL_LONG_DESCRIPTION: $('finalLongDescription').value,
    FINAL_BULLETS: $('finalBullets').value,
    FINAL_SPECS: $('finalSpecs').value,
    FINAL_SOURCES: $('finalSources').value,
    FINAL_WARNINGS: $('finalWarnings').value,
    CREATED_AT: Date.now() / 1000,
    ...extra,
  };
  await grist.docApi.applyUserActions([
    ['AddRecord', 'Naneth_AI_Runs', null, fields]
  ]);
}

async function runAi() {
  if (!state.row) return;

  const endpoint = localStorage.getItem('NANETH_AI_ENDPOINT') || '';
  if (!endpoint) {
    const entered = prompt('Enter your AI endpoint URL. It should accept JSON and return product_name, long_description, bullet_features, specs, sources, warnings.');
    if (!entered) return;
    localStorage.setItem('NANETH_AI_ENDPOINT', entered);
  }

  const payload = {
    group_sku: getField(state.row, 'GROUP_SKU'),
    prompt: getField(state.row, 'PROMPT'),
    parent_label: getField(state.row, 'PARENT_LABEL'),
    varpar_label: getField(state.row, 'VARPAR_LABEL'),
    variant_skus: getField(state.row, 'VARIANT_SKUS'),
    subvariant_skus: getField(state.row, 'SUBVARIANT_SKUS'),
    naneth_research_data: getField(state.row, 'NANETH_RESEARCH_DATA'),
    source_urls: getField(state.row, 'SOURCE_URLS'),
    html_rows: getField(state.row, 'HTML_ROWS'),
    reject_message: $('rejectMessage').value,
  };

  log('Sending prompt + Grist HTML row references to AI endpoint...');
  $('runBtn').disabled = true;

  try {
    const res = await fetch(localStorage.getItem('NANETH_AI_ENDPOINT'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const out = await res.json();

    $('finalProductName').value = out.product_name || out.final_product_name || '';
    $('finalLongDescription').value = out.long_description || out.final_long_description || '';
    $('finalBullets').value = Array.isArray(out.bullet_features) ? out.bullet_features.join('\n') : (out.bullets || out.final_bullets || '');
    $('finalSpecs').value = typeof out.specs === 'string' ? out.specs : JSON.stringify(out.specs || [], null, 2);
    $('finalSources').value = typeof out.sources === 'string' ? out.sources : JSON.stringify(out.sources || [], null, 2);
    $('finalWarnings').value = Array.isArray(out.warnings) ? out.warnings.join('\n') : (out.warnings || '');

    await updateCurrent(fieldsFromForm());
    await createRun('run', 'QA Done', {
      MODEL_1: out.model_1 || '',
      MODEL_1_OUTPUT: typeof out.model_1_output === 'string' ? out.model_1_output : JSON.stringify(out.model_1_output || {}, null, 2),
      MODEL_2: out.model_2 || '',
      MODEL_2_OUTPUT: typeof out.model_2_output === 'string' ? out.model_2_output : JSON.stringify(out.model_2_output || out, null, 2),
    });
    log('AI + QA results written to editable fields.');
  } catch (err) {
    log(`AI failed: ${err.message}`);
    await createRun('run', 'Failed', {MODEL_2_OUTPUT: String(err.stack || err.message || err)});
  } finally {
    $('runBtn').disabled = false;
  }
}

async function saveDecision() {
  await updateCurrent(fieldsFromForm());
  await createRun('save', 'Saved');
  log('Saved decision.');
}

async function skipDecision() {
  await createRun('skip', 'Skipped');
  log('Skipped group.');
}

async function rejectBackToAi() {
  await updateCurrent(fieldsFromForm());
  await createRun('reject_back_to_ai', 'Rejected Back To AI');
  log('Rejected back to AI with message.');
}

window.addEventListener('DOMContentLoaded', async () => {
  grist.ready({
    requiredAccess: 'full',
    columns: [
      'GROUP_SKU',
      'PARENT_LABEL',
      'VARPAR_LABEL',
      'VARIANT_SKUS',
      'SUBVARIANT_SKUS',
      'PROMPT',
      'NANETH_RESEARCH_DATA',
      'SOURCE_URLS',
      'HTML_ROWS',
      'NEEDS_ENRICHMENT',
      'REVIEW_STATUS',
      'FINAL_PRODUCT_NAME',
      'FINAL_LONG_DESCRIPTION',
      'FINAL_BULLETS',
      'FINAL_SPECS',
      'FINAL_SOURCES',
      'FINAL_WARNINGS',
      'REJECT_MESSAGE',
    ],
  });

  grist.onRecord((record) => {
    hydrate(record);
  });

  $('runBtn').addEventListener('click', runAi);
  $('saveBtn').addEventListener('click', saveDecision);
  $('skipBtn').addEventListener('click', skipDecision);
  $('rejectBtn').addEventListener('click', rejectBackToAi);

  log('Widget ready. Select a row in Naneth_AI_Review.');
});
