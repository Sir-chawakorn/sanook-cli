import { render } from 'ink';
import { App, type AppProps } from './app.js';

export function startRepl(props: AppProps): void {
  render(<App {...props} />);
}
