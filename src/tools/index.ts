import { readFileTool } from './read.js';
import { writeFileTool } from './write.js';
import { editFileTool } from './edit.js';
import { listDirTool } from './list.js';
import { globTool, grepTool } from './search.js';
import { bashTool } from './bash.js';
import { rememberTool } from './remember.js';
import { skillTool, createSkillTool, findSkillsTool } from './skill.js';
import { recallTool } from './recall.js';
import { scheduleTaskTool, listScheduledTool, cancelScheduledTool } from './schedule.js';
import { taskTool, taskParallelTool, taskSpawnTool, taskCollectTool, taskCancelTool, taskStatusTool } from './task.js';
import { diagnosticsTool } from './diagnostics.js';
import { gitStatusTool, gitDiffTool, gitLogTool, gitCommitTool } from './git.js';
import { haCallServiceTool, haGetStateTool, haListEntitiesTool, haListServicesTool } from './homeassistant.js';
import { pythonTool, rustTool } from './polyglot.js';
import { webFetchTool } from './web-fetch-tool.js';

/** tool registry ที่ส่งให้ agent loop */
export const tools = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  list_dir: listDirTool,
  glob: globTool,
  grep: grepTool,
  run_bash: bashTool,
  run_python: pythonTool,
  run_rust: rustTool,
  remember: rememberTool,
  recall: recallTool,
  skill: skillTool,
  find_skills: findSkillsTool,
  create_skill: createSkillTool,
  schedule_task: scheduleTaskTool,
  list_scheduled: listScheduledTool,
  cancel_scheduled: cancelScheduledTool,
  task: taskTool,
  task_parallel: taskParallelTool,
  task_spawn: taskSpawnTool,
  task_collect: taskCollectTool,
  task_cancel: taskCancelTool,
  task_status: taskStatusTool,
  diagnostics: diagnosticsTool,
  git_status: gitStatusTool,
  git_diff: gitDiffTool,
  git_log: gitLogTool,
  git_commit: gitCommitTool,
  ha_list_entities: haListEntitiesTool,
  ha_get_state: haGetStateTool,
  ha_list_services: haListServicesTool,
  ha_call_service: haCallServiceTool,
  web_fetch: webFetchTool,
};

export { readFileTool, writeFileTool, editFileTool, listDirTool, globTool, grepTool, bashTool };
