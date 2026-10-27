const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const transport = new StdioClientTransport({ command: 'node', args: [require('path').join(__dirname, '..', 'src', 'server.js')] });
  const client = new Client({ name: 'vterm-manual-test', version: '0.1.0' });
  await client.connect(transport);

  console.log('=== tools/list ===');
  const tools = await client.listTools();
  console.log(tools.tools.map(t => t.name).join(', '));

  console.log('\n=== vterm_spawn ===');
  const spawnRes = await client.callTool({ name: 'vterm_spawn', arguments: {} });
  console.log(spawnRes.content[0].text);
  const pid = spawnRes.structuredContent.pid;

  await sleep(1500);

  console.log('\n=== vterm_send (echo test) ===');
  const sendRes = await client.callTool({ name: 'vterm_send', arguments: { pid, text: 'echo VTERM_MCP_TEST_OK', enter: true } });
  console.log(sendRes.content[0].text);

  await sleep(1500);

  console.log('\n=== vterm_read ===');
  const readRes = await client.callTool({ name: 'vterm_read', arguments: { pid } });
  console.log(readRes.content[0].text);

  console.log('\n=== vterm_close ===');
  const closeRes = await client.callTool({ name: 'vterm_close', arguments: { pid } });
  console.log(closeRes.content[0].text);

  await client.close();
  process.exit(0);
})().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
