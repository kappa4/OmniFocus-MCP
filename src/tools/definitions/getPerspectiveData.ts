import { z } from 'zod';
import { getPerspectives, PerspectiveInfo } from '../primitives/getPerspectives.js';
import { getDataByPerspective, GetDataByPerspectiveParams, TaskInfo, ProjectInfo } from '../primitives/getDataByPerspective.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  perspectiveName: z.string().optional().describe("パースペクティブ名（指定しない場合は利用可能なパースペクティブ一覧を返す）"),
  hideCompleted: z.boolean().optional().describe("完了・ドロップしたアイテムを隠すかどうか（デフォルト: true）"),
  hideRecurringDuplicates: z.boolean().optional().describe("繰り返しタスクの重複を隠すかどうか（デフォルト: true）"),
  minEstimatedMinutes: z.number().optional().describe("最小推定時間（分）- この時間以上のタスクのみ表示"),
  maxEstimatedMinutes: z.number().optional().describe("最大推定時間（分）- この時間以下のタスクのみ表示"),
  flaggedOnly: z.boolean().optional().describe("フラグ付きのタスクのみ表示するかどうか（デフォルト: false）"),
  withTags: z.array(z.string()).optional().describe("指定したタグを持つタスクのみ表示"),
  withDueDate: z.boolean().optional().describe("期限が設定されているタスクのみ表示するかどうか"),
  projectName: z.string().optional().describe("指定したプロジェクトのタスクのみ表示")
});

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}分`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours}時間`;
    } else {
      return `${hours}時間${remainingMinutes}分`;
    }
  }
}

function formatTask(task: TaskInfo): string {
  const completedIcon = task.completed ? '✅' : task.flagged ? '🚩' : '⬜';
  const duration = task.estimatedMinutes ? ` (${formatDuration(task.estimatedMinutes)})` : '';
  const project = task.projectName ? ` [${task.projectName}]` : '';
  const tags = task.tags.length > 0 ? ` #${task.tags.join(' #')}` : '';
  const dueDate = task.dueDate ? ` 📅${task.dueDate.split(' ')[0]}` : '';
  
  return `${completedIcon} **${task.name}**${duration}${project}${tags}${dueDate}`;
}

function formatProject(project: ProjectInfo): string {
  const statusIcon = project.status === 'active' ? '🟢' : 
                    project.status === 'done' ? '✅' : 
                    project.status === 'dropped' ? '❌' : 
                    project.status === 'on hold' ? '⏸️' : '📋';
  const flagIcon = project.flagged ? ' 🚩' : '';
  const duration = project.estimatedMinutes ? ` (${formatDuration(project.estimatedMinutes)})` : '';
  const taskCount = project.taskCount ? ` [${project.taskCount}タスク]` : '';
  const dueDate = project.dueDate ? ` 📅${project.dueDate.split(' ')[0]}` : '';
  
  return `${statusIcon} **${project.name}**${flagIcon}${duration}${taskCount}${dueDate}`;
}

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    // パースペクティブ名が指定されていない場合は、利用可能なパースペクティブ一覧を返す
    if (!args.perspectiveName) {
      const perspectiveResult = await getPerspectives();
      
      if (perspectiveResult.success && perspectiveResult.perspectives) {
        const builtInPerspectives = perspectiveResult.perspectives
          .filter(p => p.type === 'built-in')
          .map(p => `- **${p.name}** (組み込み)`)
          .join('\n');
        
        const customPerspectives = perspectiveResult.perspectives
          .filter(p => p.type === 'custom')
          .map(p => `- **${p.name}** (カスタム)`)
          .join('\n');
        
        let output = `# 📋 利用可能なパースペクティブ\n\n`;
        
        if (builtInPerspectives) {
          output += `## 組み込みパースペクティブ\n${builtInPerspectives}\n\n`;
        }
        
        if (customPerspectives) {
          output += `## カスタムパースペクティブ\n${customPerspectives}\n\n`;
        }
        
        output += `## 使用方法\n\`perspectiveName\`パラメータに上記のパースペクティブ名を指定してください。\n\n`;
        output += `## フィルタリングオプション\n`;
        output += `- \`minEstimatedMinutes\`: 最小推定時間（例: 15分以上のタスク）\n`;
        output += `- \`maxEstimatedMinutes\`: 最大推定時間（例: 30分以下のタスク）\n`;
        output += `- \`flaggedOnly\`: フラグ付きのタスクのみ表示\n`;
        output += `- \`withDueDate\`: 期限があるタスクのみ表示\n`;
        output += `- \`projectName\`: 特定のプロジェクトのタスクのみ表示\n\n`;
        output += `## 使用例\n`;
        output += `- 「Todayに入っている15分以上のタスクを教えて」\n`;
        output += `- 「Flaggedパースペクティブのフラグ付きタスクを表示」\n`;
        output += `- 「Projectsパースペクティブで期限があるタスクを表示」`;
        
        return {
          content: [{
            type: "text" as const,
            text: output
          }]
        };
      } else {
        return {
          content: [{
            type: "text" as const,
            text: `パースペクティブ一覧の取得に失敗しました: ${perspectiveResult.error}`
          }],
          isError: true
        };
      }
    }
    
    // 指定されたパースペクティブでデータを取得
    const result = await getDataByPerspective({
      perspectiveName: args.perspectiveName,
      hideCompleted: args.hideCompleted !== false,
      hideRecurringDuplicates: args.hideRecurringDuplicates !== false,
      minEstimatedMinutes: args.minEstimatedMinutes,
      maxEstimatedMinutes: args.maxEstimatedMinutes,
      flaggedOnly: args.flaggedOnly,
      withTags: args.withTags,
      withDueDate: args.withDueDate,
      projectName: args.projectName
    });
    
    if (result.success) {
      const taskCount = result.tasks?.length || 0;
      const projectCount = result.projects?.length || 0;
      
      // フィルタ条件の説明を作成
      const filterDescriptions = [];
      if (args.minEstimatedMinutes) {
        filterDescriptions.push(`推定時間${args.minEstimatedMinutes}分以上`);
      }
      if (args.maxEstimatedMinutes) {
        filterDescriptions.push(`推定時間${args.maxEstimatedMinutes}分以下`);
      }
      if (args.flaggedOnly) {
        filterDescriptions.push('フラグ付きのみ');
      }
      if (args.withDueDate !== undefined) {
        filterDescriptions.push(args.withDueDate ? '期限あり' : '期限なし');
      }
      if (args.projectName) {
        filterDescriptions.push(`プロジェクト「${args.projectName}」`);
      }
      if (args.withTags && args.withTags.length > 0) {
        filterDescriptions.push(`タグ: ${args.withTags.join(', ')}`);
      }
      
      const filterText = filterDescriptions.length > 0 ? ` (${filterDescriptions.join(', ')})` : '';
      
      let output = `# 📋 ${result.perspective} パースペクティブ${filterText}\n\n`;
      output += `**タスク数**: ${taskCount} | **プロジェクト数**: ${projectCount}\n\n`;
      
      if (result.projects && result.projects.length > 0) {
        output += `## 📁 プロジェクト (${projectCount})\n\n`;
        result.projects.forEach(project => {
          output += `${formatProject(project)}\n`;
        });
        output += '\n';
      }
      
      if (result.tasks && result.tasks.length > 0) {
        output += `## ✅ タスク (${taskCount})\n\n`;
        
        // 推定時間でソート（指定されている場合）
        const sortedTasks = args.minEstimatedMinutes || args.maxEstimatedMinutes 
          ? [...result.tasks].sort((a, b) => (b.estimatedMinutes || 0) - (a.estimatedMinutes || 0))
          : result.tasks;
        
        sortedTasks.forEach(task => {
          output += `${formatTask(task)}\n`;
        });
        output += '\n';
      }
      
      if (taskCount === 0 && projectCount === 0) {
        output += '*指定した条件に一致するアイテムがありません。*\n';
      }
      
      // 推定時間の統計を追加
      if (result.tasks && result.tasks.length > 0) {
        const tasksWithEstimate = result.tasks.filter(t => t.estimatedMinutes && t.estimatedMinutes > 0);
        if (tasksWithEstimate.length > 0) {
          const totalMinutes = tasksWithEstimate.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
          const avgMinutes = Math.round(totalMinutes / tasksWithEstimate.length);
          output += `## 📊 推定時間統計\n`;
          output += `- **合計時間**: ${formatDuration(totalMinutes)}\n`;
          output += `- **平均時間**: ${formatDuration(avgMinutes)}\n`;
          output += `- **時間設定済みタスク**: ${tasksWithEstimate.length}/${taskCount}\n`;
        }
      }
      
      return {
        content: [{
          type: "text" as const,
          text: output
        }]
      };
    } else {
      return {
        content: [{
          type: "text" as const,
          text: `パースペクティブ "${args.perspectiveName}" からのデータ取得に失敗しました: ${result.error}`
        }],
        isError: true
      };
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`Tool execution error: ${error.message}`);
    
    return {
      content: [{
        type: "text" as const,
        text: `パースペクティブデータの取得中にエラーが発生しました: ${error.message}`
      }],
      isError: true
    };
  }
} 