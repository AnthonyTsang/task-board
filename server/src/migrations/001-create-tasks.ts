import { DataTypes, type QueryInterface, Sequelize } from 'sequelize';

export async function up({ context }: { context: QueryInterface }): Promise<void> {
  await context.createTable('tasks', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    },
    title: { type: DataTypes.TEXT, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    completed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
  });

  // The list endpoint always orders by this column.
  await context.addIndex('tasks', ['created_at'], { name: 'tasks_created_at_idx' });
}

export async function down({ context }: { context: QueryInterface }): Promise<void> {
  await context.removeIndex('tasks', 'tasks_created_at_idx');
  await context.dropTable('tasks');
}
