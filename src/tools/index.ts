import { readFileTool } from './read.js';
import { writeFileTool } from './write.js';
import { editFileTool } from './edit.js';
import { listDirTool } from './list.js';
import { globTool, grepTool } from './search.js';
import { bashTool } from './bash.js';
import { rememberTool } from './remember.js';

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
};

export { readFileTool, writeFileTool, editFileTool, listDirTool, globTool, grepTool, bashTool };
