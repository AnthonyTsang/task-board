import {
  DataTypes, Model, literal, type Sequelize,
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
      // A bare `primaryKey: true` with no defaultValue is NOT "no default on the
      // model": Sequelize still seeds the attribute to `null` on build() and binds
      // that explicit NULL in the INSERT. In Postgres an explicit NULL suppresses
      // the column default, so the migration's `DEFAULT gen_random_uuid()` never
      // fires and every insert violates the NOT NULL constraint. Declaring the
      // default as a literal SQL expression makes Sequelize render the function
      // call inline instead of binding a value — the database still owns id
      // generation (one owner), it just has to be told to call its own default
      // explicitly. Do not switch to DataTypes.UUIDV4; that moves generation into
      // the app and gives id generation two owners.
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: literal('gen_random_uuid()') },
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
