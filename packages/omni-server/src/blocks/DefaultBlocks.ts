/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import BooleanInputBlock from './DefaultBlocks/boolean_input.js'
import ColorNameBlock from './DefaultBlocks/color_name.js'
import ChatInputBlock from './DefaultBlocks/chat_input.js'
import ChatOutputBlock from './DefaultBlocks/chat_output.js'
import CustomExtensionEventComponent from './DefaultBlocks/custom_extension_event.js'
import ErrorOutputBlock from './DefaultBlocks/error_output.js'
import FileArraySplitterBlock from './DefaultBlocks/file_array_splitter.js'
import FileOutputComponent from './DefaultBlocks/file_output.js'
import FileMetaDataWriterComponent from './DefaultBlocks/file_metadata_writer.js'
import FileSwitchComponent from './DefaultBlocks/file_switch.js'
import ImageInfoBlock from './DefaultBlocks/image_info.js'
import JsonInputBlock from './DefaultBlocks/json_input.js'
import JSONataBlock from './DefaultBlocks/jsonata.js'
import LargeLanguageModelBlock from './DefaultBlocks/large_language_model.js'
import MissingBlock from './DefaultBlocks/_block_missing.js'
import MultiTextReplacerBlock from './DefaultBlocks/multi_text_replace.js'
import NameToRgbBlock from './DefaultBlocks/name_to_rgb.js'
import NumberInputBlock from './DefaultBlocks/number_input.js'
import NSFWCheckerBlock from './DefaultBlocks/NsfwDetector.js'
import PrepareImageBlock from './DefaultBlocks/prepare_image.js'
import RunScriptBlock from './DefaultBlocks/run_script.js'
import SocketTestComponent from './DefaultBlocks/socket_test.js'
import StaticDocumentComponent from './DefaultBlocks/static_document.js'
import StaticImageBlock from './DefaultBlocks/static_image.js'
import TextComparisonBlock from './DefaultBlocks/text_comparison.js'
import TextDocumentWriterComponent from './DefaultBlocks/write_text_document.js'
import TextInputBlock from './DefaultBlocks/text_input.js'
import TextReplacerBlock from './DefaultBlocks/text_replace.js'
import TextSplitterBlock from './DefaultBlocks/text_splitter.js'
import TextToJSONBlock from './DefaultBlocks/text_to_json.js'
import TokenCountBlock from './DefaultBlocks/token_count.js'
import UsageInfoBlock from './DefaultBlocks/recipe_metadata.js'
import ValidatorComponent from './DefaultBlocks/output_validator.js'
import WriteFilesToDirectoryComponent from './DefaultBlocks/file_to_directory.js'
import StaticFileComponent from './DefaultBlocks/static_file.js'
import GetFilesFromDirectoryComponent from './DefaultBlocks/files_from_directory.js';
import { LoopRecipeComponent } from './DefaultBlocks/loop_recipe.js'
import { RecipeOutputComponent } from './DefaultBlocks/recipe_output.js'
import { StringarrayToJsonComponent } from './DefaultBlocks/stringarray_to_json.js';
import { ImagesToMarkdownComponent } from './DefaultBlocks/images_to_markdown.js';
import { RecipePickerComponent } from './DefaultBlocks/recipe_picker.js';
import { NumberInputSliderBlock } from './DefaultBlocks/number_input_slider.js';
import { JsonPackerComponent} from './DefaultBlocks/json_packer.js';
import { JsonUnpackerComponent} from './DefaultBlocks/json_unpacker.js';
import { RunRecipeComponent } from './DefaultBlocks/run_recipe.js';
import  PasswordInputComponent from './DefaultBlocks/masked_input.js';
import { HuggingfaceGetModelsComponent } from './DefaultBlocks/hf_get_models.js';
import { GetRecipesComponent } from './DefaultBlocks/get_recipes.js';

const blocks = [];
blocks.push(BooleanInputBlock);
blocks.push(ChatInputBlock);
blocks.push(ChatOutputBlock);
blocks.push(ColorNameBlock);
blocks.push(CustomExtensionEventComponent);
blocks.push(ErrorOutputBlock);
blocks.push(FileArraySplitterBlock);
blocks.push(FileMetaDataWriterComponent);
blocks.push(FileOutputComponent);
blocks.push(FileSwitchComponent);
blocks.push(GetFilesFromDirectoryComponent)
blocks.push(ImageInfoBlock);
blocks.push(ImagesToMarkdownComponent);
blocks.push(JSONataBlock);
blocks.push(JsonInputBlock);
blocks.push(LargeLanguageModelBlock);
blocks.push(LoopRecipeComponent);
blocks.push(MultiTextReplacerBlock);
blocks.push(MissingBlock);
blocks.push(NameToRgbBlock);
blocks.push(NumberInputBlock);
blocks.push(NSFWCheckerBlock);
blocks.push(PrepareImageBlock);
blocks.push(PasswordInputComponent);
blocks.push(RecipeOutputComponent);
blocks.push(RunScriptBlock);
blocks.push(SocketTestComponent);
blocks.push(StaticDocumentComponent);
blocks.push(StaticFileComponent)
blocks.push(StaticImageBlock);
blocks.push(StringarrayToJsonComponent);
blocks.push(TextComparisonBlock);
blocks.push(TextDocumentWriterComponent);
blocks.push(TextInputBlock);

blocks.push(TextReplacerBlock);
blocks.push(TextSplitterBlock);
blocks.push(TextToJSONBlock);
blocks.push(TokenCountBlock);
blocks.push(UsageInfoBlock);
blocks.push(ValidatorComponent);

blocks.push(RecipePickerComponent);
blocks.push(NumberInputSliderBlock);
blocks.push(JsonPackerComponent);
blocks.push(JsonUnpackerComponent);
blocks.push(RunRecipeComponent);
blocks.push(HuggingfaceGetModelsComponent);
blocks.push(GetRecipesComponent);
blocks.push(WriteFilesToDirectoryComponent);

const OmniDefaultBlocks = blocks;
export { OmniDefaultBlocks };
