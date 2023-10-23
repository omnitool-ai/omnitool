/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

const nodeTypes = import.meta.glob('./*.hbs', { as: 'raw', eager: true });

const DefaultTemplate = nodeTypes['./default.hbs'];

const getRenderTemplate = (templateName) => {
  return nodeTypes[`./${templateName}.hbs`];
};

export { DefaultTemplate, getRenderTemplate };
