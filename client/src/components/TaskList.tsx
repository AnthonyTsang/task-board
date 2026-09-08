import type { TaskDto } from '@taskboard/shared';
import { TaskItem } from './TaskItem';

export function TaskList({ tasks }: { tasks: TaskDto[] }) {
  return (
    <ul className="mt-2">
      {tasks.map((task) => <TaskItem key={task.id} task={task} />)}
    </ul>
  );
}
