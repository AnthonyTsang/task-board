import {
  DataTypes, Model, type Sequelize,
  type InferAttributes, type InferCreationAttributes, type CreationOptional,
} from 'sequelize';
import type { TaskDto } from '@taskboard/shared';

export class Task extends Model<InferAttributes<Task>, InferCreationAttributes<Task>> {
  declare id: CreationOptional<string>;
  declare title: string;
  declare description: string | null;
  declare completed: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export type TaskModel = typeof Task;

/**
 * Initializes the model against a Sequelize instance and returns it.
 *
 * A factory rather than a module singleton: importing this file must not require
 * environment variables, or the model becomes untestable without credentials.
 */
export function initTaskModel(sequelize: Sequelize): TaskModel {
  Task.init(
    {
      // No defaultValue here on purpose — the migration's gen_random_uuid() owns
      // id generation, and Postgres returns the value via RETURNING.
      id: { type: DataTypes.UUID, primaryKey: true },
      title: { type: DataTypes.TEXT, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      completed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, tableName: 'tasks', underscored: true, timestamps: true },
  );
  return Task;
}

/** Converts a model row into the wire representation, Dates becoming ISO strings. */
export function toDto(task: Task): TaskDto {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    completed: task.completed,
    createdAt: new Date(task.createdAt).toISOString(),
    updatedAt: new Date(task.updatedAt).toISOString(),
  };
}
