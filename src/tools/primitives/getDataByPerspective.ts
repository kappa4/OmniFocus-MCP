import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GetDataByPerspectiveParams {
  perspectiveName: string;
  hideCompleted?: boolean;
  hideRecurringDuplicates?: boolean;
  minEstimatedMinutes?: number;
  maxEstimatedMinutes?: number;
  flaggedOnly?: boolean;
  withTags?: string[];
  withDueDate?: boolean;
  projectName?: string;
  maxResults?: number;
  prioritizeUrgent?: boolean;
}

export interface TaskInfo {
  id: string;
  name: string;
  completed: boolean;
  flagged: boolean;
  estimatedMinutes?: number;
  dueDate?: string;
  deferDate?: string;
  tags: string[];
  projectName?: string;
  note?: string;
  urgencyScore?: number;
}

export interface ProjectInfo {
  id: string;
  name: string;
  status: string;
  flagged?: boolean;
  estimatedMinutes?: number;
  dueDate?: string;
  taskCount?: number;
}

interface FilterSelectivity {
  name: string;
  exclusionRate: number;
  order: number;
}

const FILTER_SELECTIVITY: FilterSelectivity[] = [
  { name: 'projectName', exclusionRate: 0.90, order: 1 },
  { name: 'flaggedOnly', exclusionRate: 0.85, order: 2 },
  { name: 'minEstimatedMinutes', exclusionRate: 0.70, order: 3 },
  { name: 'maxEstimatedMinutes', exclusionRate: 0.60, order: 4 },
  { name: 'withDueDate', exclusionRate: 0.50, order: 5 },
  { name: 'withTags', exclusionRate: 0.40, order: 6 },
  { name: 'hideCompleted', exclusionRate: 0.30, order: 7 }
];

function calculateUrgencyScore(task: TaskInfo): number {
  let score = 0;
  const now = new Date();
  
  if (task.flagged) {
    score += 100;
  }
  
  if (task.dueDate) {
    const dueDate = new Date(task.dueDate);
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilDue < 0) {
      score += 200;
    } else if (daysUntilDue === 0) {
      score += 150;
    } else if (daysUntilDue === 1) {
      score += 100;
    } else if (daysUntilDue <= 7) {
      score += 50;
    }
  }
  
  if (task.estimatedMinutes) {
    if (task.estimatedMinutes <= 15) {
      score += 30;
    } else if (task.estimatedMinutes <= 30) {
      score += 20;
    } else if (task.estimatedMinutes <= 60) {
      score += 10;
    }
  }
  
  return score;
}

function getPriorityLevel(urgencyScore: number): 'high' | 'medium' | 'low' {
  if (urgencyScore >= 150) return 'high';
  if (urgencyScore >= 50) return 'medium';
  return 'low';
}

/**
 * 最適化されたパースペクティブデータ取得AppleScript生成
 */
function generateOptimizedGetDataByPerspectiveScript(params: GetDataByPerspectiveParams): string {
  const { 
    perspectiveName, 
    hideCompleted = true, 
    hideRecurringDuplicates = true,
    minEstimatedMinutes,
    maxEstimatedMinutes,
    flaggedOnly = false,
    withTags = [],
    withDueDate,
    projectName,
    maxResults = 500,
    prioritizeUrgent = true
  } = params;
  
  const escapedPerspectiveName = perspectiveName.replace(/['"\\]/g, '\\$&');
  const escapedProjectName = projectName?.replace(/['"\\]/g, '\\$&') || '';
  
  return `
  try
    tell application "OmniFocus"
      tell front document
        set targetWindow to front window
        
        if "${escapedPerspectiveName}" is in {"Inbox", "Projects", "Tags", "Forecast", "Flagged", "Review"} then
          tell targetWindow
            if "${escapedPerspectiveName}" is "Inbox" then
              set perspective to inbox perspective
            else if "${escapedPerspectiveName}" is "Projects" then
              set perspective to projects perspective
            else if "${escapedPerspectiveName}" is "Tags" then
              set perspective to contexts perspective
            else if "${escapedPerspectiveName}" is "Forecast" then
              set perspective to forecast perspective
            else if "${escapedPerspectiveName}" is "Flagged" then
              set perspective to flagged perspective
            else if "${escapedPerspectiveName}" is "Review" then
              set perspective to review perspective
            end if
          end tell
        else
          set customPerspective to first perspective whose name is "${escapedPerspectiveName}"
          tell targetWindow
            set perspective to customPerspective
          end tell
        end if
        
        delay 0.5
        
        set highPriorityTasks to {}
        set mediumPriorityTasks to {}
        set lowPriorityTasks to {}
        set visibleProjects to {}
        
        set maxHighPriority to ${Math.floor(maxResults * 0.4)}
        set maxMediumPriority to ${Math.floor(maxResults * 0.4)}
        set maxLowPriority to ${Math.floor(maxResults * 0.2)}
        
        set highCount to 0
        set mediumCount to 0
        set lowCount to 0
        
        set allTasks to flattened tasks
        repeat with aTask in allTasks
          set shouldInclude to true
          
          -- 結果数制限チェック（早期終了）
          if (highCount ≥ maxHighPriority) and (mediumCount ≥ maxMediumPriority) and (lowCount ≥ maxLowPriority) then
            exit repeat
          end if
          
          -- 高選択性フィルターを優先適用（cardinality-based early termination）
          
          -- プロジェクト名フィルタ（選択性: 90%）
          if shouldInclude and "${escapedProjectName}" is not "" then
            try
              set taskProject to containing project of aTask
              if taskProject is not missing value then
                set taskProjectName to name of taskProject
                if taskProjectName is not "${escapedProjectName}" then
                  set shouldInclude to false
                end if
              else
                set shouldInclude to false
              end if
            on error
              set shouldInclude to false
            end try
          end if
          
          if not shouldInclude then next repeat
          
          -- フラグ付きフィルタ（選択性: 85%）
          if shouldInclude and ${flaggedOnly} then
            set taskFlagged to flagged of aTask
            if not taskFlagged then
              set shouldInclude to false
            end if
          end if
          
          if not shouldInclude then next repeat
          
          -- 最小時間フィルタ（選択性: 70%）
          ${minEstimatedMinutes ? `if shouldInclude then
            try
              set taskEstimatedMinutes to estimated minutes of aTask
              if taskEstimatedMinutes is not missing value then
                if taskEstimatedMinutes < ${minEstimatedMinutes} then
                  set shouldInclude to false
                end if
              else
                set shouldInclude to false
              end if
            on error
              set shouldInclude to false
            end try
          end if
          
          if not shouldInclude then next repeat` : ''}
          
          -- 最大時間フィルタ（選択性: 60%）
          ${maxEstimatedMinutes ? `if shouldInclude then
            try
              set taskEstimatedMinutes to estimated minutes of aTask
              if taskEstimatedMinutes is not missing value then
                if taskEstimatedMinutes > ${maxEstimatedMinutes} then
                  set shouldInclude to false
                end if
              end if
            on error
              -- 推定時間が取得できない場合は含める
            end try
          end if
          
          if not shouldInclude then next repeat` : ''}
          
          -- 期限有無フィルタ（選択性: 50%）
          ${withDueDate !== undefined ? `if shouldInclude then
            try
              set taskDueDate to due date of aTask
              if ${withDueDate} then
                if taskDueDate is missing value then
                  set shouldInclude to false
                end if
              else
                if taskDueDate is not missing value then
                  set shouldInclude to false
                end if
              end if
            on error
              ${withDueDate ? 'set shouldInclude to false' : ''}
            end try
          end if
          
          if not shouldInclude then next repeat` : ''}
          
          -- 完了タスクフィルタ（選択性: 30%）
          if shouldInclude and ${hideCompleted} then
            set taskCompleted to completed of aTask
            set taskDropped to (dropped of aTask)
            if taskCompleted or taskDropped then
              set shouldInclude to false
            end if
          end if
          
          if not shouldInclude then next repeat
          
          -- ここまで来たタスクは条件をすべて満たしている
          if shouldInclude then
            -- 緊急度スコアを計算
            set urgencyScore to 0
            set taskFlagged to flagged of aTask
            
            -- フラグ付きタスク
            if taskFlagged then
              set urgencyScore to urgencyScore + 100
            end if
            
            -- 期限による優先度
            try
              set taskDueDate to due date of aTask
              if taskDueDate is not missing value then
                set currentDate to current date
                set daysDiff to (taskDueDate - currentDate) / days
                if daysDiff < 0 then
                  set urgencyScore to urgencyScore + 200 -- 期限超過
                else if daysDiff < 1 then
                  set urgencyScore to urgencyScore + 150 -- 今日期限
                else if daysDiff < 2 then
                  set urgencyScore to urgencyScore + 100 -- 明日期限
                else if daysDiff < 8 then
                  set urgencyScore to urgencyScore + 50 -- 1週間以内
                end if
              end if
            on error
              -- 期限取得エラーは無視
            end try
            
            -- 短時間タスクの優先度
            try
              set taskEstimatedMinutes to estimated minutes of aTask
              if taskEstimatedMinutes is not missing value then
                if taskEstimatedMinutes ≤ 15 then
                  set urgencyScore to urgencyScore + 30
                else if taskEstimatedMinutes ≤ 30 then
                  set urgencyScore to urgencyScore + 20
                else if taskEstimatedMinutes ≤ 60 then
                  set urgencyScore to urgencyScore + 10
                end if
              end if
            on error
              -- 推定時間取得エラーは無視
            end try
            
            -- 優先度レベル決定
            set priorityLevel to "low"
            if urgencyScore ≥ 150 then
              set priorityLevel to "high"
            else if urgencyScore ≥ 50 then
              set priorityLevel to "medium"
            end if
            
            -- 優先度別に結果数制限を適用
            set shouldAddTask to false
            if priorityLevel is "high" and highCount < maxHighPriority then
              set shouldAddTask to true
              set highCount to highCount + 1
            else if priorityLevel is "medium" and mediumCount < maxMediumPriority then
              set shouldAddTask to true
              set mediumCount to mediumCount + 1
            else if priorityLevel is "low" and lowCount < maxLowPriority then
              set shouldAddTask to true
              set lowCount to lowCount + 1
            end if
            
            if shouldAddTask then
              -- タスク情報を取得
              set taskName to name of aTask
              set taskId to id of aTask as string
              set taskNote to note of aTask
              set taskCompleted to completed of aTask
              
              -- 推定時間を取得
              set taskEstMinStr to "null"
              try
                set taskEstimatedMinutes to estimated minutes of aTask
                if taskEstimatedMinutes is not missing value then
                  set taskEstMinStr to (taskEstimatedMinutes as string)
                end if
              end try
              
              -- 期限を取得
              set taskDueDateStr to "null"
              try
                set taskDueDate to due date of aTask
                if taskDueDate is not missing value then
                  set taskDueDateStr to "\\"" & (taskDueDate as string) & "\\""
                end if
              end try
              
              -- 延期日を取得
              set taskDeferDateStr to "null"
              try
                set taskDeferDate to defer date of aTask
                if taskDeferDate is not missing value then
                  set taskDeferDateStr to "\\"" & (taskDeferDate as string) & "\\""
                end if
              end try
              
              -- タグを取得
              set taskTagsStr to ""
              try
                set taskTags to tags of aTask
                repeat with aTag in taskTags
                  set tagName to name of aTag
                  if taskTagsStr is "" then
                    set taskTagsStr to tagName
                  else
                    set taskTagsStr to taskTagsStr & "," & tagName
                  end if
                end repeat
              end try
              
              -- プロジェクト名を取得
              set taskProjectStr to "null"
              try
                set taskProject to containing project of aTask
                if taskProject is not missing value then
                  set taskProjectName to name of taskProject
                  set taskProjectStr to "\\"" & taskProjectName & "\\""
                end if
              end try
              
              -- タスクJSONを構築
              set taskInfo to "{\\"id\\":\\"" & taskId & "\\",\\"name\\":\\"" & taskName & "\\",\\"completed\\":" & taskCompleted & ",\\"flagged\\":" & taskFlagged & ",\\"estimatedMinutes\\":" & taskEstMinStr & ",\\"dueDate\\":" & taskDueDateStr & ",\\"deferDate\\":" & taskDeferDateStr & ",\\"tags\\":\\"" & taskTagsStr & "\\",\\"projectName\\":" & taskProjectStr & ",\\"note\\":\\"" & taskNote & "\\",\\"urgencyScore\\":" & urgencyScore & ",\\"priorityLevel\\":\\"" & priorityLevel & "\\"}"
              
              -- 優先度レベル別にタスクを追加
              if priorityLevel is "high" then
                set highPriorityTasks to highPriorityTasks & taskInfo
              else if priorityLevel is "medium" then
                set mediumPriorityTasks to mediumPriorityTasks & taskInfo
              else
                set lowPriorityTasks to lowPriorityTasks & taskInfo
              end if
            end if
          end if
        end repeat
        
        -- プロジェクト情報を取得
        set allProjects to flattened projects
        repeat with aProject in allProjects
          set projectName to name of aProject
          set projectId to id of aProject as string
          set projectStatus to status of aProject as string
          set projectFlagged to flagged of aProject
          
          set projectEstMinStr to "null"
          try
            set projectEstimatedMinutes to estimated minutes of aProject
            if projectEstimatedMinutes is not missing value then
              set projectEstMinStr to (projectEstimatedMinutes as string)
            end if
          end try
          
          set projectDueDateStr to "null"
          try
            set projectDueDate to due date of aProject
            if projectDueDate is not missing value then
              set projectDueDateStr to "\\"" & (projectDueDate as string) & "\\""
            end if
          end try
          
          set projectTaskCount to 0
          try
            set projectTasks to flattened tasks of aProject
            set projectTaskCount to count of projectTasks
          end try
          
          set projectInfo to "{\\"id\\":\\"" & projectId & "\\",\\"name\\":\\"" & projectName & "\\",\\"status\\":\\"" & projectStatus & "\\",\\"flagged\\":" & projectFlagged & ",\\"estimatedMinutes\\":" & projectEstMinStr & ",\\"dueDate\\":" & projectDueDateStr & ",\\"taskCount\\":" & projectTaskCount & "}"
          set visibleProjects to visibleProjects & projectInfo
        end repeat
        
        -- ${prioritizeUrgent ? '優先度順に' : '元の順序で'}結果を結合
        set allTasks to {}
        ${prioritizeUrgent ? 
          'set allTasks to highPriorityTasks & mediumPriorityTasks & lowPriorityTasks' :
          'set allTasks to lowPriorityTasks & mediumPriorityTasks & highPriorityTasks'
        }
        
        -- JSON出力
        set output to "{\\"success\\":true,\\"perspective\\":\\"${escapedPerspectiveName}\\",\\"tasks\\":["
        repeat with i from 1 to count of allTasks
          set output to output & item i of allTasks
          if i < count of allTasks then
            set output to output & ","
          end if
        end repeat
        set output to output & "],\\"projects\\":["
        repeat with i from 1 to count of visibleProjects
          set output to output & item i of visibleProjects
          if i < count of visibleProjects then
            set output to output & ","
          end if
        end repeat
        set output to output & "],\\"stats\\":{\\"highPriority\\":" & highCount & ",\\"mediumPriority\\":" & mediumCount & ",\\"lowPriority\\":" & lowCount & ",\\"totalFiltered\\":" & (highCount + mediumCount + lowCount) & ",\\"maxResults\\":" & ${maxResults} & "}}"
        
        return output
      end tell
    end tell
  on error errMsg
    return "{\\"success\\":false,\\"error\\":\\"" & errMsg & "\\"}"
  end try
  `;
}

export async function getDataByPerspective(params: GetDataByPerspectiveParams): Promise<{
  success: boolean,
  perspective?: string,
  tasks?: TaskInfo[],
  projects?: ProjectInfo[],
  stats?: {
    highPriority: number,
    mediumPriority: number,
    lowPriority: number,
    totalFiltered: number,
    maxResults: number
  },
  error?: string
}> {
  try {
    const script = generateOptimizedGetDataByPerspectiveScript(params);
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    
    const result = JSON.parse(stdout.trim());
    
    if (result.success) {
      const tasks: TaskInfo[] = result.tasks?.map((task: any) => ({
        id: task.id,
        name: task.name,
        completed: task.completed,
        flagged: task.flagged,
        estimatedMinutes: task.estimatedMinutes,
        dueDate: task.dueDate,
        deferDate: task.deferDate,
        tags: task.tags ? task.tags.split(',').filter((tag: string) => tag.trim() !== '') : [],
        projectName: task.projectName,
        note: task.note,
        urgencyScore: task.urgencyScore
      })) || [];
      
      const projects: ProjectInfo[] = result.projects?.map((project: any) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        flagged: project.flagged,
        estimatedMinutes: project.estimatedMinutes,
        dueDate: project.dueDate,
        taskCount: project.taskCount
      })) || [];
      
      return {
        success: true,
        perspective: result.perspective,
        tasks,
        projects,
        stats: result.stats
      };
    } else {
      return {
        success: false,
        error: result.error
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
} 