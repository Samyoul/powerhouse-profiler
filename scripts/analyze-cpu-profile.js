#!/usr/bin/env node
/**
 * Script to analyze CPU profile and identify call stacks for specific functions
 * Usage: node scripts/analyze-cpu-profile.js <profile-file> [--function <name>] [--file <path>] [--top <n>]
 * 
 * @example
 *   node scripts/analyze-cpu-profile.js .perf/switchboard-20251222-123012.cpuprofile --function get --file filesystem.js
 *   node scripts/analyze-cpu-profile.js .perf/switchboard-20251222-123012.cpuprofile --function get --top 20
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const profileFile = args[0];
  const options = {
    function: null,
    file: null,
    top: 20,
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--function' && args[i + 1]) {
      options.function = args[i + 1];
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      options.file = args[i + 1];
      i++;
    } else if (args[i] === '--top' && args[i + 1]) {
      options.top = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: node scripts/analyze-cpu-profile.js <profile-file> [options]

Options:
  --function <name>    Function name to analyze (default: searches for top functions)
  --file <path>       Filter by file path (partial match)
  --top <n>           Number of top call stacks to show (default: 20)
  --help, -h          Show this help message

Examples:
  node scripts/analyze-cpu-profile.js .perf/switchboard.cpuprofile --function get --file filesystem.js
  node scripts/analyze-cpu-profile.js .perf/switchboard.cpuprofile --function get --top 30
      `);
      process.exit(0);
    }
  }

  if (!profileFile) {
    console.error('Error: Profile file is required');
    console.error('Usage: node scripts/analyze-cpu-profile.js <profile-file> [options]');
    process.exit(1);
  }

  return { profileFile, options };
}

function loadProfile(profileFile) {
  try {
    const content = readFileSync(profileFile, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error loading profile: ${error.message}`);
    process.exit(1);
  }
}

function findTargetNodes(profile, functionName, filePath) {
  const nodes = profile.nodes || [];
  const targetNodes = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const callFrame = node.callFrame || {};
    const nodeFunction = callFrame.functionName || '';
    const nodeUrl = callFrame.url || '';

    const matchesFunction = !functionName || 
      nodeFunction === functionName || 
      nodeFunction.includes(functionName);
    
    const matchesFile = !filePath || 
      nodeUrl.includes(filePath);

    if (matchesFunction && matchesFile && node.hitCount > 0) {
      targetNodes.push({
        index: i,
        node,
        callFrame,
        hitCount: node.hitCount,
      });
    }
  }

  return targetNodes.sort((a, b) => b.hitCount - a.hitCount);
}

function buildNodeTree(nodes) {
  // Build a map of parent -> children
  const parentMap = new Map();
  const childMap = new Map();
  
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const children = node.children || [];
    
    for (const childIndex of children) {
      if (!parentMap.has(childIndex)) {
        parentMap.set(childIndex, []);
      }
      parentMap.get(childIndex).push(i);
      
      if (!childMap.has(i)) {
        childMap.set(i, []);
      }
      childMap.get(i).push(childIndex);
    }
  }
  
  return { parentMap, childMap };
}

function getCallStackUp(nodes, parentMap, nodeIndex, maxDepth = 20) {
  const stack = [];
  let current = nodeIndex;
  let depth = 0;
  const visited = new Set();
  
  while (current !== undefined && current >= 0 && depth < maxDepth && !visited.has(current)) {
    visited.add(current);
    
    if (current < nodes.length) {
      const node = nodes[current];
      const callFrame = node.callFrame || {};
      stack.push({
        index: current,
        function: callFrame.functionName || '(anonymous)',
        url: callFrame.url || '',
        line: callFrame.lineNumber || '',
        column: callFrame.columnNumber || '',
      });
    }
    
    // Get parent(s) - in CPU profiles, a node can have multiple parents
    const parents = parentMap.get(current);
    if (parents && parents.length > 0) {
      current = parents[0]; // Take first parent (most common case)
    } else {
      break;
    }
    
    depth++;
  }
  
  return stack;
}

function buildCallStack(profile, targetNodeIndex) {
  const nodes = profile.nodes || [];
  const samples = profile.samples || [];
  const timeDeltas = profile.timeDeltas || [];

  // Build parent-child relationships
  const { parentMap, childMap } = buildNodeTree(nodes);

  // Find all samples that are descendants of the target node
  const callStacks = [];
  const targetDescendants = new Set([targetNodeIndex]);
  
  // Find all descendants of target node
  function findDescendants(nodeIndex) {
    const children = childMap.get(nodeIndex) || [];
    for (const child of children) {
      if (!targetDescendants.has(child)) {
        targetDescendants.add(child);
        findDescendants(child);
      }
    }
  }
  findDescendants(targetNodeIndex);

  // Process samples
  for (let i = 0; i < samples.length; i++) {
    const sampleNodeIndex = samples[i];
    
    // Check if this sample is a descendant of our target
    if (!targetDescendants.has(sampleNodeIndex)) {
      // Check if target is in the call stack above this sample
      const stack = getCallStackUp(nodes, parentMap, sampleNodeIndex);
      const targetInStack = stack.some(frame => frame.index === targetNodeIndex);
      
      if (!targetInStack) {
        continue;
      }
    }
    
    // Build the full call stack
    const fullStack = getCallStackUp(nodes, parentMap, sampleNodeIndex);
    
    // Find where target appears in the stack
    const targetIndex = fullStack.findIndex(frame => frame.index === targetNodeIndex);
    if (targetIndex === -1) continue;
    
    // Get the stack from target down to the sample
    const relevantStack = fullStack.slice(0, targetIndex + 1).reverse();
    
    if (relevantStack.length > 0) {
      const timeDelta = timeDeltas[i] || 0;
      callStacks.push({
        stack: relevantStack,
        timeDelta,
        sampleIndex: i,
      });
    }
  }

  return callStacks;
}

function aggregateCallStacks(callStacks) {
  const stackMap = new Map();

  for (const { stack, timeDelta } of callStacks) {
    // Create a key from the callers (everything above the target function)
    // The stack is ordered from caller to callee, with target at the end
    const callers = stack.slice(0, -1); // Everything except the target function
    const stackKey = callers.map(f => {
      const urlShort = f.url ? f.url.split('/').pop() : '(native)';
      return `${f.function}@${urlShort}:${f.line || '?'}`;
    }).join(' -> ');

    if (!stackMap.has(stackKey)) {
      stackMap.set(stackKey, {
        stack: callers, // Callers only
        count: 0,
        totalTime: 0,
        samples: [],
      });
    }

    const entry = stackMap.get(stackKey);
    entry.count++;
    entry.totalTime += timeDelta;
    entry.samples.push(timeDelta);
  }

  return Array.from(stackMap.values())
    .sort((a, b) => b.count - a.count || b.totalTime - a.totalTime);
}

function formatStackEntry(entry, index, maxCount, targetFunction) {
  const percentage = ((entry.count / maxCount) * 100).toFixed(2);
  const avgTime = (entry.totalTime / entry.count / 1000).toFixed(2);
  const totalTime = (entry.totalTime / 1000).toFixed(2);

  console.log(`\n${index + 1}. Call Stack (${entry.count} samples, ${percentage}%, avg: ${avgTime}μs, total: ${totalTime}μs):`);
  
  // Show the call stack from top-level caller down to target
  if (entry.stack.length === 0) {
    console.log(`  └─ (direct call or root)`);
  } else {
    for (let i = 0; i < entry.stack.length; i++) {
      const frame = entry.stack[i];
      const urlShort = frame.url ? frame.url.split('/').pop() : '(native)';
      const indent = '  '.repeat(i);
      const funcName = frame.function || '(anonymous)';
      const location = frame.line ? `${urlShort}:${frame.line}` : urlShort;
      const connector = i === entry.stack.length - 1 ? '└─' : '├─';
      
      console.log(`${indent}${connector} ${funcName} (${location})`);
    }
  }
  
  // Show target function
  const targetIndent = '  '.repeat(entry.stack.length);
  console.log(`${targetIndent}└─ ${targetFunction} (target)`);
}

function analyzeChildren(profile, targetNodeIndex, topN) {
  const nodes = profile.nodes || [];
  const samples = profile.samples || [];
  const timeDeltas = profile.timeDeltas || [];
  const { childMap } = buildNodeTree(nodes);
  
  // Find all descendants
  const descendants = new Set();
  function collectDescendants(nodeIndex) {
    const children = childMap.get(nodeIndex) || [];
    for (const child of children) {
      if (!descendants.has(child)) {
        descendants.add(child);
        collectDescendants(child);
      }
    }
  }
  collectDescendants(targetNodeIndex);
  
  // Count samples in descendants
  const descendantCounts = new Map();
  for (let i = 0; i < samples.length; i++) {
    const sampleNodeIndex = samples[i];
    if (descendants.has(sampleNodeIndex)) {
      const count = descendantCounts.get(sampleNodeIndex) || 0;
      descendantCounts.set(sampleNodeIndex, count + 1);
    }
  }
  
  // Get top descendants
  const topDescendants = Array.from(descendantCounts.entries())
    .map(([nodeIndex, count]) => {
      const node = nodes[nodeIndex];
      const callFrame = node.callFrame || {};
      return {
        index: nodeIndex,
        function: callFrame.functionName || '(anonymous)',
        url: callFrame.url || '',
        line: callFrame.lineNumber || '',
        hitCount: node.hitCount || 0,
        sampleCount: count,
      };
    })
    .sort((a, b) => b.sampleCount - a.sampleCount)
    .slice(0, topN);
  
  return topDescendants;
}

function analyzeProfile(profile, targetNodes, topN) {
  console.log('='.repeat(80));
  console.log('CPU Profile Call Stack Analysis');
  console.log('='.repeat(80));
  console.log(`\nProfile Duration: ${((profile.endTime - profile.startTime) / 1000000).toFixed(2)} seconds`);
  console.log(`Total Samples: ${(profile.samples || []).length}`);
  console.log(`Target Nodes Found: ${targetNodes.length}\n`);

  if (targetNodes.length === 0) {
    console.log('No matching nodes found. Try different search criteria.');
    return;
  }

  for (const targetNode of targetNodes) {
    const { index, callFrame, hitCount } = targetNode;
    const urlShort = callFrame.url ? callFrame.url.split('/').pop() : '(native)';
    const location = callFrame.lineNumber ? `${urlShort}:${callFrame.lineNumber}` : urlShort;

    console.log('\n' + '='.repeat(80));
    console.log(`Target Function: ${callFrame.functionName || '(anonymous)'}`);
    console.log(`Location: ${location}`);
    console.log(`Hit Count: ${hitCount}`);
    console.log('='.repeat(80));

    // Build call stacks
    const callStacks = buildCallStack(profile, index);
    
    if (!callStacks || callStacks.length === 0) {
      console.log('\nNo call stacks found for this function.');
      continue;
    }

    console.log(`\nTotal call stack samples: ${callStacks.length}`);

    // Aggregate call stacks
    const aggregated = aggregateCallStacks(callStacks);
    const maxCount = aggregated[0]?.count || 1;

    console.log(`\nTop ${Math.min(topN, aggregated.length)} Call Stacks:`);
    console.log('-'.repeat(80));

    const targetFuncName = callFrame.functionName || '(anonymous)';
    for (let i = 0; i < Math.min(topN, aggregated.length); i++) {
      formatStackEntry(aggregated[i], i, maxCount, targetFuncName);
    }

    // Summary statistics
    const totalSamples = aggregated.reduce((sum, e) => sum + e.count, 0);
    const totalTime = aggregated.reduce((sum, e) => sum + e.totalTime, 0);
    
    console.log('\n' + '-'.repeat(80));
    console.log(`Summary:`);
    console.log(`  Total unique call stacks: ${aggregated.length}`);
    console.log(`  Total samples: ${totalSamples}`);
    console.log(`  Total time: ${(totalTime / 1000).toFixed(2)}μs`);
    console.log(`  Average time per sample: ${(totalTime / totalSamples / 1000).toFixed(2)}μs`);
    
    // Analyze what this function calls (children)
    console.log('\n' + '='.repeat(80));
    console.log(`Functions Called BY "${callFrame.functionName || '(anonymous)'}" (where time is actually spent):`);
    console.log('='.repeat(80));
    
    const children = analyzeChildren(profile, index, topN);
    if (children.length > 0) {
      const totalChildSamples = children.reduce((sum, c) => sum + c.sampleCount, 0);
      console.log(`\nTop ${children.length} functions called (by sample count):\n`);
      
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const pct = ((child.sampleCount / totalChildSamples) * 100).toFixed(2);
        const urlShort = child.url ? child.url.split('/').pop() : '(native)';
        const location = child.line ? `${urlShort}:${child.line}` : urlShort;
        
        console.log(`${(i + 1).toString().padStart(2)}. ${child.function.padEnd(50)} | ${child.sampleCount.toString().padStart(6)} samples (${pct.padStart(5)}%) | ${location}`);
      }
      
      console.log(`\nTotal samples in called functions: ${totalChildSamples}`);
    } else {
      console.log('\nNo child functions found (function may be leaf node or samples not captured).');
    }
  }
}

function main() {
  const { profileFile, options } = parseArgs();
  
  console.log(`Loading profile: ${profileFile}`);
  const profile = loadProfile(profileFile);

  // If no function specified, find top functions
  if (!options.function) {
    console.log('\nNo function specified. Finding top functions...\n');
    const nodes = profile.nodes || [];
    const topFunctions = nodes
      .map((node, i) => ({
        index: i,
        callFrame: node.callFrame || {},
        hitCount: node.hitCount || 0,
      }))
      .filter(n => n.hitCount > 0)
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 10);

    console.log('Top 10 Functions by Hit Count:');
    topFunctions.forEach((f, i) => {
      const urlShort = f.callFrame.url ? f.callFrame.url.split('/').pop() : '(native)';
      console.log(`  ${i + 1}. ${f.callFrame.functionName || '(anonymous)'} - ${f.hitCount} hits (${urlShort})`);
    });
    console.log('\nUse --function <name> to analyze a specific function.\n');
    return;
  }

  // Find target nodes
  const targetNodes = findTargetNodes(profile, options.function, options.file);

  if (targetNodes.length === 0) {
    console.log(`\nNo nodes found matching:`);
    console.log(`  Function: ${options.function || '(any)'}`);
    console.log(`  File: ${options.file || '(any)'}`);
    return;
  }

  // Analyze call stacks
  analyzeProfile(profile, targetNodes, options.top);
}

main();

