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
import { taskTool } from './task.js';
import { gitStatusTool, gitDiffTool, gitLogTool, gitCommitTool } from './git.js';

/** tool registry ที่ส่งให้ agent loop */
export const tools = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  list_dir: listDirTool,
  glob: globTool,
  grep: grepTool,
  run_bash: bashTool,
  remember: rememberTool,
  recall: recallTool,
  skill: skillTool,
  find_skills: findSkillsTool,
  create_skill: createSkillTool,
  schedule_task: scheduleTaskTool,
  list_scheduled: listScheduledTool,
  cancel_scheduled: cancelScheduledTool,
  task: taskTool,
  git_status: gitStatusTool,
  git_diff: gitDiffTool,
  git_log: gitLogTool,
  git_commit: gitCommitTool,
};

export { readFileTool, writeFileTool, editFileTool, listDirTool, globTool, grepTool, bashTool };
