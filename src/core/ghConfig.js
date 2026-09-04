/* ══════════ GITHUB JOB LAUNCHER CONFIG ══════════ */
// JobLauncherTab, QBankConverterTab, QuestionGenTab — সবগুলোতে শেয়ার হয়

const LS_GH_CFG = "gh_job_launcher_cfg";
const JOB_NONE_TAG = "__NONE__";
function loadGhCfg(){
  const defaults = {repo:"hanif4343/smart-study-admin-app", token:"", workflowExplain:"generate-explanations.yml", workflowQuestions:"generate-questions.yml", workflowMcqOptions:"generate-mcq-options.yml"};
  try{
    const raw = localStorage.getItem(LS_GH_CFG);
    if(raw) return {...defaults, ...JSON.parse(raw)};
  }catch{}
  return defaults;
}
function saveGhCfgLS(cfg){
  try{ localStorage.setItem(LS_GH_CFG, JSON.stringify(cfg)); }catch{}
}

export { LS_GH_CFG, JOB_NONE_TAG, loadGhCfg, saveGhCfgLS };
