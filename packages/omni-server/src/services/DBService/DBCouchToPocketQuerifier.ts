/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

// @ts-nocheck AUTOGEN
/* eslint-disable */
import { MangoQuery } from 'nano';

class DBCouchToPocketQuerifier {
  private static operatorMap = {
    $eq: '=',
    $ne: '!=',
    $gt: '>',
    $gte: '>=',
    $lt: '<',
    $lte: '<=',
    $elemMatch: '~',
    $or: '||',
    $and: '&&',
    $exists: '!='
  };

  // Function to translate a Mango query
  public static translateQuery(mangoQuery: MangoQuery): string {
    let translatedQuery = '';

    for (let field in mangoQuery.selector) {
      let operand = mangoQuery.selector[field];
      translatedQuery += DBCouchToPocketQuerifier.translateCondition(field, operand);
    }

    // Remove the trailing ' && '
    return translatedQuery.slice(0, -4);
  }

  private static translateCondition(field: string, operand: any, parentField?: string): string {
    let translatedCondition = '';

    if (Array.isArray(operand) && (field === '$or' || field === '$and')) {
      // Handle $or and $and operator
      let operator = DBCouchToPocketQuerifier.operatorMap[field];
      let translatedConditions = operand.map((condition: any) => {
        // Translate each condition in the $or/$and array separately
        let subQuery = DBCouchToPocketQuerifier.translateQuery({ selector: condition });
        return `(${subQuery})`;
      });
      translatedCondition += `${translatedConditions.join(` ${operator} `)} && `;
    } else if (typeof operand === 'object' && operand !== null) {
      for (let operator in operand) {
        if (DBCouchToPocketQuerifier.operatorMap[operator]) {
          let translatedOperator = DBCouchToPocketQuerifier.translateOperator(operator);
          if (operator === '$elemMatch') {
            let subField = Object.keys(operand[operator])[0];
            let subValue = operand[operator][subField];
            translatedCondition += `blob.${field} ${translatedOperator} '${subValue}' && `;
          } else if (operator === '$exists') {
            let existenceCheck = operand[operator] ? '!= null' : '= null';
            translatedCondition += `blob.${field} ${existenceCheck} && `;
          } else {
            // For boolean values, do not enclose in quotes
            let value = typeof operand[operator] === 'boolean' ? operand[operator] : `'${operand[operator]}'`;
            translatedCondition += `blob.${field} ${translatedOperator} ${value} && `;
          }
        } else {
          // Handle nested field
          translatedCondition += DBCouchToPocketQuerifier.translateCondition(operator, operand[operator], field);
        }
      }
    } else {
      let translatedOperator = DBCouchToPocketQuerifier.translateOperator('$eq');
      let fullFieldPath = parentField ? `${parentField}.${field}` : field;
      // For boolean values, do not enclose in quotes
      let value = typeof operand === 'boolean' ? operand : `'${operand}'`;
      translatedCondition += `blob.${fullFieldPath} ${translatedOperator} ${value} && `;
    }

    return translatedCondition;
  }

  // Function to translate a Mango operator
  private static translateOperator(mangoOperator: string): string {
    let translatedOperator = DBCouchToPocketQuerifier.operatorMap[mangoOperator];
    if (!translatedOperator) {
      throw new Error(`Unrecognized or unsupported operator: ${mangoOperator}`);
    }
    return translatedOperator;
  }
}

export { DBCouchToPocketQuerifier };
