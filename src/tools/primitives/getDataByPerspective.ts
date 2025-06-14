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

/**
 * 特定のパースペクティブでフィルタリングされたデータを取得するAppleScriptを生成
 */
function generateGetDataByPerspectiveScript(params: GetDataByPerspectiveParams): string {
  const { 
    perspectiveName, 
    hideCompleted = true, 
    hideRecurringDuplicates = true,
    minEstimatedMinutes,
    maxEstimatedMinutes,
    flaggedOnly = false,
    withTags = [],
    withDueDate,
    projectName
  } = params;
  
  const escapedPerspectiveName = perspectiveName.replace(/['"\\]/g, '\\$&');
  const escapedProjectName = projectName?.replace(/['"\\]/g, '\\$&') || '';
  
  return `
  try
    tell application "OmniFocus"
      tell front document
        -- パースペクティブを設定
        set targetWindow to front window
        
        -- 組み込みパースペクティブの場合
        if "${escapedPerspectiveName}" is in {"Inbox", "Projects", "Tags", "Forecast", "Flagged", "Review"} then
          -- 組み込みパースペクティブを表示
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
          -- カスタムパースペクティブの場合
          set customPerspective to first perspective whose name is "${escapedPerspectiveName}"
          tell targetWindow
            set perspective to customPerspective
          end tell
        end if
        
        delay 0.5
        
        -- 現在のビューからタスクとプロジェクトを取得
        set visibleTasks to {}
        set visibleProjects to {}
        
        -- フラット化されたタスクから可視のものを取得
        set allTasks to flattened tasks
        repeat with aTask in allTasks
          set taskCompleted to completed of aTask
          set taskDropped to (dropped of aTask)
          set taskFlagged to flagged of aTask
          
          -- 基本的なフィルタリング
          set shouldInclude to true
          if ${hideCompleted} and (taskCompleted or taskDropped) then
            set shouldInclude to false
          end if
          
          -- フラグ付きのみのフィルタ
          if ${flaggedOnly} and not taskFlagged then
            set shouldInclude to false
          end if
          
          -- プロジェクト名でのフィルタ
          if "${escapedProjectName}" is not "" then
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
          
          -- 推定時間でのフィルタ
          if shouldInclude then
            try
              set taskEstimatedMinutes to estimated minutes of aTask
              if taskEstimatedMinutes is not missing value then
                ${minEstimatedMinutes ? `
                if taskEstimatedMinutes < ${minEstimatedMinutes} then
                  set shouldInclude to false
                end if` : ''}
                ${maxEstimatedMinutes ? `
                if taskEstimatedMinutes > ${maxEstimatedMinutes} then
                  set shouldInclude to false
                end if` : ''}
              else
                ${minEstimatedMinutes ? 'set shouldInclude to false' : ''}
              end if
            on error
              ${minEstimatedMinutes ? 'set shouldInclude to false' : ''}
            end try
          end if
          
          -- 期限の有無でのフィルタ
          ${withDueDate !== undefined ? `
          if shouldInclude then
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
          end if` : ''}
          
          if shouldInclude then
            -- タスク情報を取得
            set taskName to name of aTask
            set taskId to id of aTask as string
            set taskNote to note of aTask
            
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
            
            -- プロジェクト名を取得
            set taskProjectNameStr to "null"
            try
              set taskProject to containing project of aTask
              if taskProject is not missing value then
                set taskProjectNameStr to "\\"" & (name of taskProject) & "\\""
              end if
            end try
            
            -- タグを取得
            set taskTagsStr to "[]"
            try
              set taskTags to tags of aTask
              if (count of taskTags) > 0 then
                set tagList to {}
                repeat with aTag in taskTags
                  set end of tagList to "\\"" & (name of aTag) & "\\""
                end repeat
                set AppleScript's text item delimiters to ","
                set taskTagsStr to "[" & (tagList as string) & "]"
                set AppleScript's text item delimiters to ""
              end if
            end try
            
            set taskInfo to "{\\"id\\":\\"" & taskId & "\\",\\"name\\":\\"" & taskName & "\\",\\"completed\\":" & taskCompleted & ",\\"flagged\\":" & taskFlagged & ",\\"estimatedMinutes\\":" & taskEstMinStr & ",\\"dueDate\\":" & taskDueDateStr & ",\\"deferDate\\":" & taskDeferDateStr & ",\\"projectName\\":" & taskProjectNameStr & ",\\"tags\\":" & taskTagsStr & ",\\"note\\":\\"" & taskNote & "\\"}"
            set end of visibleTasks to taskInfo
          end if
        end repeat
        
        -- フラット化されたプロジェクトから可視のものを取得
        set allProjects to flattened projects
        repeat with aProject in allProjects
          set projectCompleted to (status of aProject is done)
          set projectDropped to (status of aProject is dropped)
          
          -- 完了/ドロップしたプロジェクトを隠すかどうか
          set shouldInclude to true
          if ${hideCompleted} and (projectCompleted or projectDropped) then
            set shouldInclude to false
          end if
          
          if shouldInclude then
            set projectName to name of aProject
            set projectId to id of aProject as string
            set projectStatus to status of aProject as string
            set projectFlagged to flagged of aProject
            
            -- プロジェクトの推定時間を取得
            set projectEstMinStr to "null"
            try
              set projectEstimatedMinutes to estimated minutes of aProject
              if projectEstimatedMinutes is not missing value then
                set projectEstMinStr to (projectEstimatedMinutes as string)
              end if
            end try
            
            -- プロジェクトの期限を取得
            set projectDueDateStr to "null"
            try
              set projectDueDate to due date of aProject
              if projectDueDate is not missing value then
                set projectDueDateStr to "\\"" & (projectDueDate as string) & "\\""
              end if
            end try
            
            -- プロジェクト内のタスク数を取得
            set projectTaskCount to count of tasks of aProject
            
            set projectInfo to "{\\"id\\":\\"" & projectId & "\\",\\"name\\":\\"" & projectName & "\\",\\"status\\":\\"" & projectStatus & "\\",\\"flagged\\":" & projectFlagged & ",\\"estimatedMinutes\\":" & projectEstMinStr & ",\\"dueDate\\":" & projectDueDateStr & ",\\"taskCount\\":" & projectTaskCount & "}"
            set end of visibleProjects to projectInfo
          end if
        end repeat
        
        -- 結果をJSON形式で構築
        set AppleScript's text item delimiters to ","
        set tasksJson to "[" & (visibleTasks as string) & "]"
        set projectsJson to "[" & (visibleProjects as string) & "]"
        set AppleScript's text item delimiters to ""
        
        set resultJson to "{\\"success\\":true,\\"perspective\\":\\"${escapedPerspectiveName}\\",\\"tasks\\":" & tasksJson & ",\\"projects\\":" & projectsJson & "}"
        
        return resultJson
      end tell
    end tell
  on error errorMessage
    return "{\\"success\\":false,\\"error\\":\\"" & errorMessage & "\\"}"
  end try
  `;
}

/**
 * 特定のパースペクティブでフィルタリングされたデータを取得
 */
export async function getDataByPerspective(params: GetDataByPerspectiveParams): Promise<{
  success: boolean,
  perspective?: string,
  tasks?: TaskInfo[],
  projects?: ProjectInfo[],
  error?: string
}> {
  try {
    const script = generateGetDataByPerspectiveScript(params);
    
    console.error(`Executing AppleScript for perspective: ${params.perspectiveName}`);
    if (params.minEstimatedMinutes) {
      console.error(`Filtering tasks with >= ${params.minEstimatedMinutes} minutes`);
    }
    if (params.maxEstimatedMinutes) {
      console.error(`Filtering tasks with <= ${params.maxEstimatedMinutes} minutes`);
    }
    
    const { stdout, stderr } = await execAsync(`osascript -e '${script}'`);
    
    if (stderr) {
      console.error("AppleScript stderr:", stderr);
    }
    
    console.error("AppleScript stdout:", stdout);
    
    try {
      const result = JSON.parse(stdout);
      return result;
    } catch (parseError) {
      console.error("Error parsing AppleScript result:", parseError);
      return {
        success: false,
        error: `Failed to parse result: ${stdout}`
      };
    }
  } catch (error: any) {
    console.error("Error in getDataByPerspective execution:", error);
    return {
      success: false,
      error: error?.message || "Unknown error in getDataByPerspective"
    };
  }
} 