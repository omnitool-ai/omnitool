/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { OAIBaseComponent, OmniComponentMacroTypes, OmniComponentFlags, BlockCategory as Category } from 'omni-sockets';
import { type Workflow } from 'omni-shared';

const NS_OMNI = 'omnitool';
const component = OAIBaseComponent.create(NS_OMNI, 'recipe_metadata')
  .fromScratch()
  .set(
    'description',
    'Set essential information for your recipe, including the title, introduction, help section, author, and credits for your recipe. Make the most of this block to enhance the presentation and user-friendliness of your recipes.'
  )
  .set('title', 'Recipe Metadata')
  .set('category', Category.RECIPE_OPERATIONS)
  .setMethod('X-NOOP')
  .setFlag(OmniComponentFlags.NO_EXECUTE, true)
  .setFlag(OmniComponentFlags.UNIQUE_PER_WORKFLOW, true)
  .setRenderTemplate('simple');

component.addInput(
  component.createInput('usage', 'object').set('title', 'Usage Information').setHidden(true).toOmniIO()
);

component.addOutput(component.createOutput('text', 'string').setHidden(true).toOmniIO());

const titleControl = component.createControl('title');
titleControl
  .setRequired(true)
  .setControlType('AlpineTextComponent')
  .set('description', 'The title for this recipe')
  .set('placeholder', 'My Awesome Recipe');
component.addControl(titleControl.toOmniControl());

const introductionControl = component.createControl('description');
introductionControl
  .setControlType('AlpineTextComponent')
  .set('description', 'A description of this recipe')
  .set('placeholder', 'Enter a short description of this recipe here.');
component.addControl(introductionControl.toOmniControl());

const helpControl = component.createControl('help');
helpControl
  .setControlType('AlpineTextComponent')
  .set(
    'description',
    'Text with instructions and information about this recipe that is shown to the user when they open it.'
  )
  .set('placeholder', 'Enter text or markdown to be shown when the user opens this recipe.');
component.addControl(helpControl.toOmniControl());

const authorControl = component.createControl('author');
authorControl
  .setControlType('AlpineTextComponent')
  .set('description', 'Author information such as name, email, website, etc.')
  .set('placeholder', 'Enter author information here.');
component.addControl(authorControl.toOmniControl());
/*
const categoryControl = component.createControl('category');
categoryControl
  .setControlType('AlpineSelectComponent')
  .set('title', 'Category')
  .set('description', 'Choose the category that best describes your recipe.')
  .setChoices(
    [
      'General',
      'Art & Design',
      'Automotive',
      'Beauty & Fashion',
      'Books & Reference',
      'Business',
      'Communication',
      'Development',
      'Education',
      'Entertainment',
      'Finance',
      'Food & Dining',
      'Gaming',
      'Health, Wellness & Medical',
      'Jobs & Career',
      'Lifestyle, Hobbies & DIY',
      'Marketing',
      'Maps',
      'Music & Audio',
      'News & Magazines',
      'Pets',
      'Photography',
      'Productivity',
      'Real Estate',
      'Religion',
      'Safety & Security',
      'Shopping',
      'Sports',
      'Social Networking',
      'Travel',
      'Utilities',
      'Weather'
    ],
    'General'
  );
component.addControl(categoryControl.toOmniControl());
*/
const tagsControl = component.createControl('tags');
tagsControl.setControlType('AlpineSelect2TagComponent').set('title', 'Tags').set('placeholder', 'Enter tags here.');
component.addControl(tagsControl.toOmniControl());

const licenseControl = component.createControl('license');
licenseControl
  .setControlType('AlpineSelectComponent')
  .set('title', 'License')
  .set('description', 'Licensing information for the recipe, such as MIT, GPL, CC0 etc.')
  .setChoices(
    [
      {
        title: 'MIT License',
        value: 'MIT',
        description: 'A permissive license that allows for re-use with few restrictions.'
      },
      {
        title: 'GNU General Public License (GPL)',
        value: 'GPL',
        description: 'A copyleft license that requires any modifications to be open-sourced.'
      },
      {
        title: 'Creative Commons Zero (CC0)',
        value: 'CC0',
        description: 'A public domain dedication tool, meaning no rights reserved.'
      },
      {
        title: 'Creative Commons Attribution (CC-BY)',
        value: 'CC-BY',
        description:
          'Allows others to distribute and build upon the work, even commercially, as long as credit is provided.'
      },
      {
        title: 'Creative Commons Attribution-ShareAlike (CC-BY-SA)',
        value: 'CC-BY-SA',
        description: 'Similar to CC-BY but derivatives must license their new creations under identical terms.'
      },
      {
        title: 'Creative Commons Attribution-NoDerivs (CC-BY-ND)',
        value: 'CC-BY-ND',
        description: "Allows for redistribution, commercial or non-commercial, but doesn't allow derivative works."
      },
      {
        title: 'Creative Commons Attribution-NonCommercial (CC-BY-NC)',
        value: 'CC-BY-NC',
        description: 'Allows for derivatives but not for commercial use.'
      },
      {
        title: 'Creative Commons Attribution-NonCommercial-ShareAlike (CC-BY-NC-SA)',
        value: 'CC-BY-NC-SA',
        description:
          'Allows derivatives but they must not be used commercially and should be licensed under the same terms.'
      },
      {
        title: 'Creative Commons Attribution-NonCommercial-NoDerivs (CC-BY-NC-ND)',
        value: 'CC-BY-NC-ND',
        description: 'Only allows for non-commercial redistribution and no derivatives are allowed.'
      },
      {
        title: 'Proprietary License',
        value: 'Proprietary',
        description: 'A license retaining all rights and usually not allowing distribution or modifications.'
      },
      {
        title: 'Other (See Credits)',
        value: 'Other (See Credits)',
        description: 'A custom license or one not listed here. See the associated credits or documentation for details.'
      }
    ],
    'CC0'
  )

  .set('placeholder', 'Enter licensing information here.');

component.addControl(licenseControl.toOmniControl());
const creditsControl = component.createControl('credits');
creditsControl
  .setControlType('AlpineTextComponent')
  .set('description', 'Further information that is shown to the users when they inspect the recipe.')
  .set(
    'placeholder',
    'Enter credits, acknowledgements, 3rd party licenses, legal notices, data sources or other metadata here.'
  );
component.addControl(creditsControl.toOmniControl());

component
  .createControl('ui_template')
  .setControlType('AlpineTextComponent')
  .set('description', 'Further information that is shown to the users when they inspect the recipe.')
  .set('placeholder', 'Custom UI Template');

component.addControl(creditsControl.toOmniControl());

component.addControl(
  component
    .createControl('button')
    .set('title', 'Save')
    .setControlType('AlpineButtonComponent')
    .setCustom('buttonAction', 'script')
    .setCustom('buttonValue', 'save')
    .set('description', 'Save')
    .toOmniControl()
);

component.setMeta({
  source: {
    summary: 'A component that allows you to provide instructions and help to users about how to use your recipe',
    authors: ['Mercenaries.ai Team'],
    links: {
      'Mercenaries.ai': 'https://mercenaries.ai'
    }
  }
});

component.setMacro(OmniComponentMacroTypes.ON_SAVE, async (node: any, recipe: Workflow) => {
  node.data.title = (node.data.title || recipe.meta.name || '(Unnamed Recipe)').substr(0, 50).trim();
  node.data.description = (node.data.description || recipe.meta.description || '').substr(0, 2048).trim();
  node.data.author = (node.data.author || recipe.meta.author || 'Anonymous').trim();
  node.data.help = (node.data.help || recipe.meta.help || '').substr(0, 2048).trim();

  //TODO: purge old compatibility fix
  delete node.data.introduction;
  recipe.setMeta({
    name: node.data.title || recipe.meta.name,
    description: node.data.description || recipe.meta.description,
    author: node.data.author || recipe.meta.author,
    help: node.data.help || recipe.meta.help,
    // Ensures other properties are preserved
    pictureUrl: recipe.meta.pictureUrl,
    created: recipe.meta.created,
    updated: Date.now(),
    tags: node.data.tags || recipe.meta.tags,
    category: /*node.data.category || */recipe.meta.category
  });
  recipe.setUI({
    template: node.data.ui_template
  });

  return true;
});

const RecipeMetadataBlock = component.toJSON();
export default RecipeMetadataBlock;
