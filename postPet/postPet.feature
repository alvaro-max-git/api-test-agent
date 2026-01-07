Feature: Add a new pet
  As a store user
  I want to add a new pet to the store
  So that it can be managed and retrieved later

  Background:
    Given the Petstore service is available

  Scenario Outline: Successfully add a new pet with a valid status
    # Target URL: {{baseUrl}}/pet
    Given I have a new pet with a name and at least one photo
    And the pet has the status "<status>"
    When I add the pet to the store
    Then the response status code should be 200
    And the created pet details should be returned
    And the created pet should include a unique identifier

    Examples:
      | status    |
      | available |
      | pending   |
      | sold      |

  Scenario: Successfully add a new pet without specifying a status
    # Target URL: {{baseUrl}}/pet
    Given I have a new pet with a name and at least one photo
    And I do not specify a status
    When I add the pet to the store
    Then the response status code should be 200
    And the created pet details should be returned
    And the created pet should include a unique identifier

  Scenario: Add a new pet with category and tags
    # Target URL: {{baseUrl}}/pet
    Given I have a new pet with a name and at least one photo
    And the pet includes a category and tags
    When I add the pet to the store
    Then the response status code should be 200
    And the created pet details should be returned
    And the created pet should include a unique identifier

  Scenario: Reject creating a pet when the name is missing
    # Target URL: {{baseUrl}}/pet
    Given I have a new pet with photos
    And the pet name is missing
    When I add the pet to the store
    Then the response status code should be 405

  Scenario: Reject creating a pet when photos are missing
    # Target URL: {{baseUrl}}/pet
    Given I have a new pet with a name
    And the pet has no photos
    When I add the pet to the store
    Then the response status code should be 405
